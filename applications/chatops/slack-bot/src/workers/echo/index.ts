// Echo Worker Lambda - Responds with sync and async messages

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('Echo worker invoked', {
    recordCount: event.Records.length
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message: WorkerMessage = JSON.parse(record.body);

      logger.info('Processing echo command', {
        text: message.text,
        user: message.user_name
      });

      // Send synchronous response
      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: `sync ${message.text}`
      });

      logger.info('Sync response sent');

      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send asynchronous response
      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: `async ${message.text}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Async Response*\n\`\`\`${message.text}\`\`\``
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Requested by <@${message.user_id}>`
              }
            ]
          }
        ]
      });

      logger.info('Async response sent');
    } catch (error) {
      logger.error('Failed to process echo command', error as Error, {
        messageId: record.messageId
      });

      // Add to failed items for retry
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

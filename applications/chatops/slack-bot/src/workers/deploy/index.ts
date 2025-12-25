// Deploy Worker Lambda - Handles deployment commands

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('Deploy worker invoked', {
    recordCount: event.Records.length
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message: WorkerMessage = JSON.parse(record.body);

      logger.info('Processing deploy command', {
        text: message.text,
        user: message.user_name
      });

      // Parse deployment target from text
      const target = message.text.trim() || 'default';

      // Send initial response
      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: `:rocket: Starting deployment to \`${target}\`...`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:rocket: *Deployment Started*\nTarget: \`${target}\`\nRequested by: <@${message.user_id}>`
            }
          }
        ]
      });

      // Simulate deployment process
      const steps = [
        { name: 'Validating configuration', duration: 2000 },
        { name: 'Building application', duration: 3000 },
        { name: 'Running tests', duration: 2000 },
        { name: 'Deploying to AWS', duration: 4000 },
        { name: 'Verifying deployment', duration: 2000 }
      ];

      for (const [index, step] of steps.entries()) {
        logger.info(`Deployment step: ${step.name}`);
        await new Promise(resolve => setTimeout(resolve, step.duration));

        // Send progress update
        const progress = Math.round(((index + 1) / steps.length) * 100);
        await sendSlackResponse(message.response_url, {
          response_type: 'in_channel',
          text: `[${progress}%] ${step.name}...`
        });
      }

      // Send final success message
      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: `:white_check_mark: Deployment to \`${target}\` completed successfully!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:white_check_mark: *Deployment Successful*\nTarget: \`${target}\`\nDuration: ${steps.reduce((sum, s) => sum + s.duration, 0) / 1000}s`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Deployed by <@${message.user_id}> | ${new Date().toISOString()}`
              }
            ]
          }
        ]
      });

      logger.info('Deployment completed');
    } catch (error) {
      logger.error('Failed to process deploy command', error as Error, {
        messageId: record.messageId
      });

      const message: WorkerMessage = JSON.parse(record.body);

      // Send failure notification
      try {
        await sendSlackResponse(message.response_url, {
          response_type: 'in_channel',
          text: `:x: Deployment failed: ${(error as Error).message}`
        });
      } catch (notifyError) {
        logger.error('Failed to send error notification', notifyError as Error);
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

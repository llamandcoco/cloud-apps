// Echo Handler - Responds with sync and async messages

import AWSXRay from 'aws-xray-sdk-core';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';

/**
 * Handle echo command
 * Sends synchronous and asynchronous responses to Slack
 */
export async function handleEcho(message: WorkerMessage, messageId: string): Promise<void> {
  const startTime = Date.now();

  // Create child logger with correlation ID for request tracing
  const messageLogger = logger.child(message.correlation_id || messageId, {
    component: 'echo-handler',
    command: message.command,
    userId: message.user_id,
  });

  messageLogger.info('Processing echo command', {
    text: message.text,
    user: message.user_name,
    messageId,
  });

  // Create X-Ray subsegment for processing
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment('ProcessEchoCommand');

  try {
    subsegment?.addAnnotation('correlationId', message.correlation_id || 'unknown');
    subsegment?.addAnnotation('command', message.command);
    subsegment?.addMetadata('message', {
      text: message.text,
      user: message.user_name,
    });

    // Send synchronous response
    const syncStart = Date.now();
    await sendSlackResponse(message.response_url, {
      response_type: 'in_channel',
      text: `sync ${message.text}`,
    });
    const syncDuration = Date.now() - syncStart;

    messageLogger.info('Sync response sent', {
      duration: syncDuration,
    });

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send asynchronous response
    const asyncStart = Date.now();
    await sendSlackResponse(message.response_url, {
      response_type: 'in_channel',
      text: `async ${message.text}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Async Response*\n\`\`\`${message.text}\`\`\``,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Requested by <@${message.user_id}>`,
            },
          ],
        },
      ],
    });
    const asyncDuration = Date.now() - asyncStart;

    messageLogger.info('Async response sent', {
      duration: asyncDuration,
    });

    subsegment?.close();

    const totalDuration = Date.now() - startTime;

    messageLogger.info('Echo command processed successfully', {
      totalDuration,
    });
  } catch (error) {
    subsegment?.addError(error as Error);
    subsegment?.close();
    throw error;
  }
}

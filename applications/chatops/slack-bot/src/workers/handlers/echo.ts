// Echo Handler - Responds with sync and async messages

import AWSXRay from 'aws-xray-sdk-core';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';

/**
 * Handler result with performance metrics
 */
interface HandlerResult {
  syncResponseMs?: number;
  asyncResponseMs?: number;
}

/**
 * Handle echo command
 * Sends synchronous and asynchronous responses to Slack
 *
 * @param message - Worker message from SQS
 * @param messageId - SQS message ID
 * @returns Performance metrics for the worker to log
 */
export async function handleEcho(
  message: WorkerMessage,
  messageId: string
): Promise<HandlerResult> {
  let syncResponseMs: number | undefined;
  let asyncResponseMs: number | undefined;

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

  // Create X-Ray subsegment for processing (skip if no active segment)
  const xrayNamespace = (AWSXRay as unknown as { getNamespace?: () => { get?: (key: string) => unknown } }).getNamespace?.();
  const segment = (xrayNamespace?.get?.('segment') as AWSXRay.Segment | undefined) ?? undefined;
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
    syncResponseMs = Date.now() - syncStart;

    messageLogger.info('Sync response sent', {
      duration: syncResponseMs,
    });

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
    asyncResponseMs = Date.now() - asyncStart;

    messageLogger.info('Async response sent', {
      duration: asyncResponseMs,
    });

    subsegment?.close();

    messageLogger.info('Echo command processed successfully');

    // Return performance metrics for the worker to log
    return {
      syncResponseMs,
      asyncResponseMs,
    };
  } catch (error) {
    subsegment?.addError(error as Error);
    subsegment?.close();
    throw error;
  }
}

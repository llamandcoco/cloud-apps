// Deploy Worker Lambda - Handles both manual and scheduled deployment requests

import { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';
import { handleScheduledDeployment } from './scheduled-handler';
import { handleManualDeployment } from './manual-handler';

type LambdaEvent = SQSEvent | EventBridgeEvent<string, any>;

/**
 * Main handler - Routes to appropriate sub-handler based on event type
 */
export async function handler(event: LambdaEvent): Promise<SQSBatchResponse | void> {
  logger.info('Deploy worker invoked', { eventSource: getEventSource(event) });

  // Check if this is an EventBridge scheduled event
  if (isEventBridgeEvent(event)) {
    logger.info('Handling scheduled deployment from EventBridge');
    await handleScheduledDeployment(event as EventBridgeEvent<string, any>);
    return;
  }

  // Otherwise, handle as SQS event (manual deployment)
  return await handleSQSEvent(event as SQSEvent);
}

/**
 * Handle SQS events (manual deployments from Slack)
 */
async function handleSQSEvent(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('Handling manual deployment from SQS', {
    recordCount: event.Records.length
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message: WorkerMessage = JSON.parse(record.body);
      await handleManualDeployment(message);
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

/**
 * Type guard to check if event is from EventBridge
 */
function isEventBridgeEvent(event: LambdaEvent): boolean {
  return 'source' in event && 'detail-type' in event;
}

/**
 * Get event source for logging
 */
function getEventSource(event: LambdaEvent): string {
  if (isEventBridgeEvent(event)) {
    return 'EventBridge';
  }
  return 'SQS';
}

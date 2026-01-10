// LW (Long-Write) Unified Worker - Routes all long-write commands to handlers

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { WorkerMessage } from '../../shared/types';
import { handleBuild } from '../handlers/build';

// Import future long-write handlers here
// import { handleDeploy } from '../handlers/deploy';

/**
 * Command handler registry
 * Maps command names to their handler functions
 */
const COMMAND_HANDLERS: Record<string, (message: WorkerMessage, messageId: string) => Promise<void>> = {
  '/build': handleBuild,
  // Add new long-write commands here (no infrastructure changes needed!)
  // '/deploy': handleDeploy,
};

/**
 * Unified LW worker handler
 * Routes commands to appropriate handlers based on command type
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('LW unified worker invoked', {
    recordCount: event.Records.length,
    quadrant: 'long-write',
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const startTime = Date.now();
    let messageLogger = logger;

    try {
      const message: WorkerMessage = JSON.parse(record.body);
      const correlationId = message.correlation_id;

      // Create child logger with correlation ID for request tracing
      messageLogger = logger.child(correlationId || record.messageId, {
        component: 'lw-worker',
        command: message.command,
        userId: message.user_id,
        quadrant: 'long-write',
      });

      messageLogger.info('Routing command to handler', {
        command: message.command,
        text: message.text,
        user: message.user_name,
        messageId: record.messageId,
      });

      // Find handler for command
      const handler = COMMAND_HANDLERS[message.command];

      if (!handler) {
        const availableCommands = Object.keys(COMMAND_HANDLERS).join(', ');
        const errorMsg = `Unknown command: ${message.command}. Available long-write commands: ${availableCommands}`;

        messageLogger.error(errorMsg, new Error('Unknown command'), {
          command: message.command,
          availableCommands,
        });

        throw new Error(errorMsg);
      }

      // Execute handler
      await handler(message, record.messageId);

      const duration = Date.now() - startTime;
      messageLogger.info('Command processed successfully', {
        command: message.command,
        duration,
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      messageLogger.error('Failed to process command', error as Error, {
        messageId: record.messageId,
        duration,
      });

      // Add to failed items for retry
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  logger.info('LW worker batch complete', {
    total: event.Records.length,
    failed: batchItemFailures.length,
    succeeded: event.Records.length - batchItemFailures.length,
  });

  return { batchItemFailures };
}

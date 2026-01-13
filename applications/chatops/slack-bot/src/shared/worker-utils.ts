// Shared worker utilities for unified command routing

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from './logger';
import { WorkerMessage } from './types';

/**
 * Handler result with performance metrics
 */
export interface HandlerResult {
  syncResponseMs?: number;
  asyncResponseMs?: number;
}

/**
 * Configuration for a unified worker
 */
export interface WorkerConfig {
  componentName: string;  // e.g., 'sr-worker', 'sw-worker'
  quadrantName: string;   // e.g., 'short-read', 'short-write'
  commandHandlers: Record<
    string,
    (message: WorkerMessage, messageId: string) => Promise<HandlerResult | void>
  >;
}

/**
 * Log worker performance metrics for monitoring and analysis
 */
function logWorkerMetrics(
  componentName: string,
  params: {
    correlationId?: string;
    command?: string;
    totalE2eMs?: number;
    workerDurationMs: number;
    queueWaitMs?: number;
    syncResponseMs?: number;
    asyncResponseMs?: number;
    success: boolean;
    errorType?: string;
    errorMessage?: string;
  }
) {
  logger.info('Performance metrics', {
    ...params,
    component: componentName,
  });
}

/**
 * Creates a unified worker handler function configured for a specific component
 * This eliminates code duplication across SR, SW, LR, and LW workers
 */
export function createUnifiedWorkerHandler(config: WorkerConfig) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    logger.info(`${config.componentName.toUpperCase()} unified worker invoked`, {
      recordCount: event.Records.length,
      quadrant: config.quadrantName,
    });

    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      const startTime = Date.now();
      let messageLogger = logger;
      let correlationId: string | undefined;

      try {
        const message: WorkerMessage = JSON.parse(record.body);
        correlationId = message.correlation_id;

        // Create child logger with correlation ID for request tracing
        messageLogger = logger.child(correlationId || record.messageId, {
          component: config.componentName,
          command: message.command,
          userId: message.user_id,
          quadrant: config.quadrantName,
        });

        messageLogger.info('Routing command to handler', {
          command: message.command,
          text: message.text,
          user: message.user_name,
          messageId: record.messageId,
        });

        // Find handler for command
        const handler = config.commandHandlers[message.command];

        if (!handler) {
          const availableCommands = Object.keys(config.commandHandlers).join(', ');
          const errorMsg = `Unknown command: ${message.command}. Available ${config.quadrantName} commands: ${availableCommands || 'none'}`;

          messageLogger.error(errorMsg, new Error('Unknown command'), {
            command: message.command,
            availableCommands,
          });

          throw new Error(errorMsg);
        }

        // Execute handler and get performance metrics
        const handlerResult = await handler(message, record.messageId);

        const totalDuration = Date.now() - startTime;
        const e2eDuration = message.api_gateway_start_time
          ? Date.now() - message.api_gateway_start_time
          : undefined;

        // Log structured performance metrics for CloudWatch Insights analysis
        // Only if handler returned performance metrics
        if (handlerResult && typeof handlerResult === 'object') {
          logWorkerMetrics(config.componentName, {
            correlationId,
            command: message.command,
            totalE2eMs: e2eDuration,
            workerDurationMs: totalDuration,
            queueWaitMs: e2eDuration ? Math.max(0, e2eDuration - totalDuration) : undefined,
            syncResponseMs: handlerResult.syncResponseMs,
            asyncResponseMs: handlerResult.asyncResponseMs,
            success: true,
          });
        }

        messageLogger.info('Command processed successfully', {
          command: message.command,
          duration: totalDuration,
          e2eDuration,
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        const err = error as Error;

        messageLogger.error('Failed to process command', err, {
          messageId: record.messageId,
          duration,
        });

        // Log performance metrics even for failures
        logWorkerMetrics(config.componentName, {
          correlationId,
          workerDurationMs: duration,
          success: false,
          errorType: err.name,
          errorMessage: err.message,
        });

        // Add to failed items for retry
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    logger.info(`${config.componentName.toUpperCase()} worker batch complete`, {
      total: event.Records.length,
      failed: batchItemFailures.length,
      succeeded: event.Records.length - batchItemFailures.length,
    });

    return { batchItemFailures };
  };
}

// LR (Long-Read) Unified Worker - Routes all long-read commands to handlers

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { WorkerMessage } from '../../shared/types';

// Import future long-read handlers here
// import { handleAnalyze } from '../handlers/analyze';
// import { handleReport } from '../handlers/report';

/**
 * Log worker performance metrics for monitoring and analysis
 */
function logWorkerMetrics(params: {
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
}) {
  logger.info('Performance metrics', {
    ...params,
    component: 'lr-worker', // Add component identifier for filtering
  });
}

/**
 * Handler result with performance metrics
 */
interface HandlerResult {
  syncResponseMs?: number;
  asyncResponseMs?: number;
}

/**
 * Command handler registry
 * Maps command names to their handler functions
 */
const COMMAND_HANDLERS: Record<
  string,
  (message: WorkerMessage, messageId: string) => Promise<HandlerResult>
> = {
  // Add new long-read commands here (no infrastructure changes needed!)
  // '/analyze': handleAnalyze,
  // '/report': handleReport,
};

/**
 * Unified LR worker handler
 * Routes commands to appropriate handlers based on command type
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('LR unified worker invoked', {
    recordCount: event.Records.length,
    quadrant: 'long-read',
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
        component: 'lr-worker',
        command: message.command,
        userId: message.user_id,
        quadrant: 'long-read',
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
        const errorMsg = `Unknown command: ${message.command}. Available long-read commands: ${availableCommands || 'none'}`;

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
      logWorkerMetrics({
        correlationId,
        command: message.command,
        totalE2eMs: e2eDuration,
        workerDurationMs: totalDuration,
        queueWaitMs: e2eDuration ? Math.max(0, e2eDuration - totalDuration) : undefined,
        syncResponseMs: handlerResult.syncResponseMs,
        asyncResponseMs: handlerResult.asyncResponseMs,
        success: true,
      });

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
      logWorkerMetrics({
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

  logger.info('LR worker batch complete', {
    total: event.Records.length,
    failed: batchItemFailures.length,
    succeeded: event.Records.length - batchItemFailures.length,
  });

  return { batchItemFailures };
}

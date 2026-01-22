// Shared worker utilities for unified command routing

import { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda';
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
    (message: WorkerMessage, messageId: string) => Promise<HandlerResult>
  >;
}

/**
 * Log worker performance metrics for monitoring and analysis
 * 
 * This function logs structured performance data to CloudWatch for:
 * - E2E latency tracking (from API Gateway to worker completion)
 * - Queue wait time analysis
 * - Sync/async response time breakdown
 * - Error tracking and categorization
 * 
 * @param componentName - Worker component identifier (e.g., 'sr-worker', 'lw-worker')
 * @param params - Performance metrics to log
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
 * Parse and validate the worker message from SQS record
 */
function parseWorkerMessage(record: SQSRecord): WorkerMessage {
  return JSON.parse(record.body);
}

/**
 * Create a child logger with correlation context
 */
function createMessageLogger(
  correlationId: string | undefined,
  messageId: string,
  config: WorkerConfig,
  message: WorkerMessage
) {
  return logger.child(correlationId || messageId, {
    component: config.componentName,
    command: message.command,
    userId: message.user_id,
    quadrant: config.quadrantName,
  });
}

/**
 * Find and validate the command handler
 */
function getCommandHandler(
  message: WorkerMessage,
  config: WorkerConfig
): (message: WorkerMessage, messageId: string) => Promise<HandlerResult> {
  const handler = config.commandHandlers[message.command];
  
  if (!handler) {
    const availableCommands = Object.keys(config.commandHandlers).join(', ');
    throw new Error(
      `Unknown command: ${message.command}. Available ${config.quadrantName} commands: ${availableCommands || 'none'}`
    );
  }
  
  return handler;
}

/**
 * Calculate performance metrics
 */
function calculatePerformanceMetrics(
  startTime: number,
  message: WorkerMessage
) {
  const totalDuration = Date.now() - startTime;
  const e2eDuration = message.api_gateway_start_time
    ? Date.now() - message.api_gateway_start_time
    : undefined;
  const queueWaitMs = e2eDuration ? Math.max(0, e2eDuration - totalDuration) : undefined;

  return {
    totalDuration,
    e2eDuration,
    queueWaitMs,
  };
}

/**
 * Process a single SQS record
 */
async function processRecord(
  record: SQSRecord,
  config: WorkerConfig
): Promise<{ success: boolean; itemIdentifier: string }> {
  const startTime = Date.now();
  let messageLogger = logger;
  let correlationId: string | undefined;

  try {
    const message = parseWorkerMessage(record);
    correlationId = message.correlation_id;

    messageLogger = createMessageLogger(correlationId, record.messageId, config, message);

    messageLogger.info('Routing command to handler', {
      command: message.command,
      text: message.text,
      user: message.user_name,
      messageId: record.messageId,
    });

    const handler = getCommandHandler(message, config);
    const handlerResult = await handler(message, record.messageId);

    const { totalDuration, e2eDuration, queueWaitMs } = calculatePerformanceMetrics(
      startTime,
      message
    );

    logWorkerMetrics(config.componentName, {
      correlationId,
      command: message.command,
      totalE2eMs: e2eDuration,
      workerDurationMs: totalDuration,
      queueWaitMs,
      syncResponseMs: handlerResult.syncResponseMs,
      asyncResponseMs: handlerResult.asyncResponseMs,
      success: true,
    });

    messageLogger.info('Command processed successfully', {
      command: message.command,
      duration: totalDuration,
      e2eDuration,
    });

    return { success: true, itemIdentifier: record.messageId };

  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as Error;

    messageLogger.error('Failed to process command', err, {
      messageId: record.messageId,
      duration,
    });

    logWorkerMetrics(config.componentName, {
      correlationId,
      workerDurationMs: duration,
      success: false,
      errorType: err.name,
      errorMessage: err.message,
    });

    return { success: false, itemIdentifier: record.messageId };
  }
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
      const result = await processRecord(record, config);
      
      if (!result.success) {
        batchItemFailures.push({ itemIdentifier: result.itemIdentifier });
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

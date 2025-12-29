// Simple structured logger for Lambda

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

class Logger {
  private logLevel: LogLevel;
  private correlationId?: string;
  private context?: Record<string, unknown>;

  constructor(correlationId?: string, context?: Record<string, unknown>) {
    const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
    this.logLevel = ['debug', 'info', 'warn', 'error'].includes(level)
      ? (level as LogLevel)
      : 'info';
    this.correlationId = correlationId;
    this.context = context;
  }

  /**
   * Create a child logger with correlation ID and context
   */
  child(correlationId: string, context?: Record<string, unknown>): Logger {
    return new Logger(correlationId, { ...this.context, ...context });
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private getTraceContext(): Record<string, unknown> {
    const traceContext: Record<string, unknown> = {};

    // Add X-Ray trace ID if available
    if (process.env._X_AMZN_TRACE_ID) {
      traceContext.traceId = process.env._X_AMZN_TRACE_ID;
    }

    // Add AWS Request ID if available
    if (process.env.AWS_REQUEST_ID) {
      traceContext.requestId = process.env.AWS_REQUEST_ID;
    }

    return traceContext;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT || 'unknown',
      org: process.env.ORG_PREFIX || 'unknown',
      ...(this.correlationId && { correlationId: this.correlationId }),
      ...this.getTraceContext(),
      ...this.context,
      ...metadata
    };

    console.log(JSON.stringify(entry));
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.log('warn', message, metadata);
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>) {
    this.log('error', message, {
      ...metadata,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    });
  }
}

export const logger = new Logger();

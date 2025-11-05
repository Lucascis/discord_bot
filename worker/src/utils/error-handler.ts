/**
 * Error Handling System for Worker Service
 *
 * Structured error classes and handling patterns for job processing
 * Following Discord bot error management best practices
 */

import { logger } from '@discord-bot/logger';
import type { JobError, JobErrorTypeValue } from '../types/jobs.js';

/**
 * Base worker error class
 */
export abstract class WorkerError extends Error {
  abstract readonly type: JobErrorTypeValue;
  abstract readonly retryable: boolean;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.code = code;
    this.details = details;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to JobError interface
   */
  toJobError(): JobError {
    return {
      type: this.type,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      retryable: this.retryable
    };
  }
}

/**
 * Validation error - input data is invalid
 */
export class ValidationError extends WorkerError {
  readonly type = 'VALIDATION_ERROR' as JobErrorTypeValue;
  readonly retryable = false;

  constructor(
    field: string,
    value: unknown,
    expected: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Validation failed for field '${field}': expected ${expected}, got ${typeof value}`,
      'VALIDATION_FAILED',
      { field, value, expected, ...details }
    );
  }
}

/**
 * Database error - database operation failed
 */
export class DatabaseError extends WorkerError {
  readonly type = 'DATABASE_ERROR' as JobErrorTypeValue;
  readonly retryable: boolean;

  constructor(
    operation: string,
    cause: Error,
    retryable: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(
      `Database operation failed: ${operation} - ${cause.message}`,
      'DATABASE_OPERATION_FAILED',
      { operation, originalError: cause.message, ...details }
    );
    this.retryable = retryable;
  }
}

/**
 * External API error - third-party service failure
 */
export class ExternalAPIError extends WorkerError {
  readonly type = 'EXTERNAL_API_ERROR' as JobErrorTypeValue;
  readonly retryable: boolean;

  constructor(
    service: string,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(
      `External API error from ${service}: ${statusCode} - ${message}`,
      'EXTERNAL_API_FAILED',
      { service, statusCode, ...details }
    );

    // Retry on 5xx and specific 4xx errors
    this.retryable = statusCode >= 500 || statusCode === 429 || statusCode === 408;
  }
}

/**
 * Timeout error - operation took too long
 */
export class TimeoutError extends WorkerError {
  readonly type = 'TIMEOUT_ERROR' as JobErrorTypeValue;
  readonly retryable = true;

  constructor(
    operation: string,
    timeout: number,
    details?: Record<string, unknown>
  ) {
    super(
      `Operation '${operation}' timed out after ${timeout}ms`,
      'OPERATION_TIMEOUT',
      { operation, timeout, ...details }
    );
  }
}

/**
 * Resource error - insufficient resources (memory, disk, etc.)
 */
export class ResourceError extends WorkerError {
  readonly type = 'RESOURCE_ERROR' as JobErrorTypeValue;
  readonly retryable = true;

  constructor(
    resource: string,
    current: number,
    required: number,
    details?: Record<string, unknown>
  ) {
    super(
      `Insufficient ${resource}: required ${required}, available ${current}`,
      'INSUFFICIENT_RESOURCES',
      { resource, current, required, ...details }
    );
  }
}

/**
 * Unknown error - unexpected failure
 */
export class UnknownError extends WorkerError {
  readonly type = 'UNKNOWN_ERROR' as JobErrorTypeValue;
  readonly retryable = true;

  constructor(
    originalError: Error,
    context?: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Unknown error${context ? ` in ${context}` : ''}: ${originalError.message}`,
      'UNKNOWN_FAILURE',
      { originalError: originalError.message, stack: originalError.stack, ...details }
    );
  }
}

/**
 * Error classification utility
 */
export function classifyError(error: unknown): WorkerError {
  if (error instanceof WorkerError) {
    return error;
  }

  if (error instanceof Error) {
    // Database-related errors
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('connection') ||
        error.message.includes('timeout')) {
      return new DatabaseError('connection', error, true);
    }

    // Validation errors
    if (error.message.includes('validation') ||
        error.message.includes('invalid') ||
        error.message.includes('required')) {
      return new ValidationError('unknown', null, 'valid data', { originalMessage: error.message });
    }

    // Timeout errors
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return new TimeoutError('unknown operation', 30000, { originalMessage: error.message });
    }

    // Resource errors
    if (error.message.includes('ENOMEM') ||
        error.message.includes('out of memory') ||
        error.message.includes('ENOSPC')) {
      return new ResourceError('memory/disk', 0, 1, { originalMessage: error.message });
    }

    return new UnknownError(error);
  }

  // Non-Error objects
  return new UnknownError(
    new Error(String(error)),
    'non-error-thrown',
    { type: typeof error, value: error }
  );
}

/**
 * Enhanced error logging with context
 */
export function logJobError(
  error: WorkerError,
  jobId: string,
  queueName: string,
  jobData?: Record<string, unknown>
): void {
  const logContext = {
    jobId,
    queueName,
    errorType: error.type,
    errorCode: error.code,
    retryable: error.retryable,
    timestamp: error.timestamp,
    jobData: jobData ? { ...jobData, sensitive: '[REDACTED]' } : undefined,
    details: error.details
  };

  if (error.retryable) {
    logger.warn(logContext, `Retryable job error: ${error.message}`);
  } else {
    logger.error(logContext, `Non-retryable job error: ${error.message}`);
  }
}

/**
 * Create retry strategy based on error type
 */
export function createRetryStrategy(error: WorkerError): {
  shouldRetry: boolean;
  delay: number;
  maxAttempts: number;
} {
  if (!error.retryable) {
    return {
      shouldRetry: false,
      delay: 0,
      maxAttempts: 0
    };
  }

  switch (error.type) {
    case 'DATABASE_ERROR':
      return {
        shouldRetry: true,
        delay: 2000, // 2 seconds base delay
        maxAttempts: 5
      };

    case 'EXTERNAL_API_ERROR':
      return {
        shouldRetry: true,
        delay: 5000, // 5 seconds base delay
        maxAttempts: 3
      };

    case 'TIMEOUT_ERROR':
      return {
        shouldRetry: true,
        delay: 3000, // 3 seconds base delay
        maxAttempts: 3
      };

    case 'RESOURCE_ERROR':
      return {
        shouldRetry: true,
        delay: 10000, // 10 seconds base delay
        maxAttempts: 2
      };

    case 'UNKNOWN_ERROR':
      return {
        shouldRetry: true,
        delay: 1000, // 1 second base delay
        maxAttempts: 2
      };

    default:
      return {
        shouldRetry: false,
        delay: 0,
        maxAttempts: 0
      };
  }
}

/**
 * Safe error handler wrapper for job processors
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const workerError = classifyError(error);

      // Log the error with context
      logger.error({
        error: workerError.toJobError(),
        functionName: fn.name,
        args: args.length
      }, 'Job processor error caught and classified');

      throw workerError;
    }
  };
}
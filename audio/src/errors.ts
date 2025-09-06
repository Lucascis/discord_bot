import { logger } from '@discord-bot/logger';

export class AudioError extends Error {
  constructor(
    message: string,
    public code: string,
    public guildId?: string,
    public isRetryable: boolean = false,
  ) {
    super(message);
    this.name = 'AudioError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PlayerError extends AudioError {
  constructor(message: string, guildId?: string, isRetryable: boolean = false) {
    super(message, 'PLAYER_ERROR', guildId, isRetryable);
    this.name = 'PlayerError';
  }
}

export class SearchError extends AudioError {
  constructor(message: string, guildId?: string) {
    super(message, 'SEARCH_ERROR', guildId, true);
    this.name = 'SearchError';
  }
}

export class LavalinkError extends AudioError {
  constructor(message: string, guildId?: string, isRetryable: boolean = true) {
    super(message, 'LAVALINK_ERROR', guildId, isRetryable);
    this.name = 'LavalinkError';
  }
}

/**
 * Higher-order function to wrap async functions with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context?: string,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error({
        error: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        context,
      }, 'Error in audio system');
      throw error;
    }
  }) as T;
}

/**
 * Retry wrapper for operations that might fail temporarily
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000,
  context?: string,
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts) {
        logger.error({
          error: {
            name: lastError.name,
            message: lastError.message,
            stack: lastError.stack,
          },
          context,
          attempt,
          maxAttempts,
        }, 'Operation failed after all retry attempts');
        break;
      }
      
      // Check if error is retryable
      if (error instanceof AudioError && !error.isRetryable) {
        logger.warn({
          error: error.message,
          context,
          attempt,
        }, 'Non-retryable error, stopping retry attempts');
        break;
      }
      
      logger.warn({
        error: lastError.message,
        context,
        attempt,
        maxAttempts,
        delay,
      }, 'Operation failed, retrying');
      
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
  
  throw lastError;
}

/**
 * Safe wrapper for Redis operations
 */
export async function safeRedisOperation<T>(
  operation: () => Promise<T>,
  fallback: T,
  context?: string,
): Promise<T> {
  try {
    return await withRetry(operation, 2, 500, context);
  } catch (error) {
    logger.error({
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
      },
      context,
    }, 'Redis operation failed, using fallback');
    return fallback;
  }
}

/**
 * Safe JSON parsing with error handling
 */
export function safeParse<T = any>(json: string, defaultValue: T, context?: string): T {
  try {
    return JSON.parse(json);
  } catch (error) {
    logger.warn({ 
      json: json.slice(0, 100), 
      error: error instanceof Error ? error.message : String(error),
      context 
    }, 'Failed to parse JSON, using default');
    return defaultValue;
  }
}

/**
 * Graceful degradation handler for audio operations
 */
export async function withGracefulDegradation<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T> | T,
  context?: string,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    logger.warn({
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
      },
      context,
    }, 'Primary operation failed, using fallback');
    
    try {
      return await fallback();
    } catch (fallbackError) {
      logger.error({
        primaryError: error instanceof Error ? error.message : String(error),
        fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        context,
      }, 'Both primary and fallback operations failed');
      throw fallbackError;
    }
  }
}
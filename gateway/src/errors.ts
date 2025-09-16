import { logger } from '@discord-bot/logger';
import type { Interaction } from 'discord.js';
import { Counter, register } from 'prom-client';

// Error metrics
const discordApiErrorCounter = new Counter({
  name: 'discord_api_errors_total',
  help: 'Total number of Discord API errors',
  labelNames: ['operation', 'error_code', 'retryable'],
  registers: [register]
});

const discordOperationRetryCounter = new Counter({
  name: 'discord_operation_retries_total',
  help: 'Total number of Discord operation retries',
  labelNames: ['operation', 'attempt'],
  registers: [register]
});

const discordOperationDuration = new Counter({
  name: 'discord_operation_duration_seconds_total',
  help: 'Total duration of Discord operations',
  labelNames: ['operation', 'success'],
  registers: [register]
});

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    if (field) {
      this.message = `${field}: ${message}`;
    }
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class PermissionError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'PERMISSION_DENIED', 403);
    this.name = 'PermissionError';
  }
}

export class AudioError extends AppError {
  constructor(message: string, public guildId?: string) {
    super(message, 'AUDIO_ERROR', 500);
    this.name = 'AudioError';
  }
}

export class DiscordError extends AppError {
  constructor(message: string = 'Discord API error', public discordCode?: number) {
    super(message, 'DISCORD_ERROR', 502);
    this.name = 'DiscordError';
  }
}

/**
 * Discord API Error codes that should not retry
 */
const NON_RETRYABLE_DISCORD_CODES = [
  10003, // Unknown Channel
  10008, // Unknown Message
  10013, // Unknown User
  10014, // Unknown Emoji
  50001, // Missing Access
  50013, // Missing Permissions
  50035, // Invalid Form Body
];

/**
 * Discord API Error codes that indicate temporary issues
 */
const RETRYABLE_DISCORD_CODES = [
  20028, // Rate limited
  130000, // API Overloaded
];

/**
 * Safely handle Discord API operations with automatic error recovery
 */
export async function safeDiscordOperation<T>(
  operation: () => Promise<T>,
  context: string,
  options: {
    maxRetries?: number;
    fallback?: () => Promise<T | null>;
    onError?: (error: Error) => void;
  } = {}
): Promise<T | null> {
  const { maxRetries = 2, fallback, onError } = options;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      // Record successful operation metrics
      const duration = (Date.now() - startTime) / 1000;
      discordOperationDuration.labels(context, 'true').inc(duration);

      if (attempt > 0) {
        logger.info({ context, attempts: attempt + 1 }, 'Discord operation succeeded after retry');
      }

      return result;
    } catch (error: any) {
      const discordCode = error?.code;
      const isDiscordAPIError = error?.name === 'DiscordAPIError';
      const isRetryable = !isDiscordAPIError || !NON_RETRYABLE_DISCORD_CODES.includes(discordCode);

      // Record error metrics
      discordApiErrorCounter.labels(
        context,
        String(discordCode || 'unknown'),
        String(isRetryable)
      ).inc();

      if (attempt > 0) {
        discordOperationRetryCounter.labels(context, String(attempt + 1)).inc();
      }

      // Log the error with full context
      logger.warn({
        context,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        discordCode,
        isRetryable,
        error: {
          name: error.name,
          message: error.message,
          code: error.code
        }
      }, 'Discord operation failed');

      // Handle non-retryable errors immediately
      if (isDiscordAPIError && NON_RETRYABLE_DISCORD_CODES.includes(discordCode)) {
        logger.info({ context, discordCode }, 'Non-retryable Discord error, stopping attempts');
        if (onError) onError(error);
        break;
      }

      // If this is the last attempt, break
      if (attempt === maxRetries) {
        logger.error({ context, attempts: attempt + 1, error }, 'All Discord operation attempts failed');
        if (onError) onError(error);
        break;
      }

      // Wait before retry (exponential backoff for rate limits)
      const delay = discordCode === 20028 ? 2000 * (attempt + 1) : 500 * (attempt + 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Record failed operation metrics
  const duration = (Date.now() - startTime) / 1000;
  discordOperationDuration.labels(context, 'false').inc(duration);

  // Try fallback if available
  if (fallback) {
    try {
      logger.info({ context }, 'Attempting fallback operation');
      const fallbackResult = await fallback();
      if (fallbackResult !== null) {
        discordOperationDuration.labels(`${context}_fallback`, 'true').inc();
      }
      return fallbackResult;
    } catch (fallbackError) {
      logger.error({ context, fallbackError }, 'Fallback operation also failed');
      discordOperationDuration.labels(`${context}_fallback`, 'false').inc();
    }
  }

  return null;
}

/**
 * Centralized error handler for Discord interactions
 */
export async function handleInteractionError(
  error: Error,
  interaction: Interaction,
  context?: string,
): Promise<void> {
  const errorId = Math.random().toString(36).substring(2, 15);
  
  logger.error({
    errorId,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    interaction: {
      type: interaction.type,
      user: interaction.user?.id || 'unknown',
      guild: interaction.guildId,
      channel: interaction.channelId,
    },
    context,
  }, 'Interaction error occurred');

  let userMessage = 'An error occurred while processing your request.';
  const ephemeral = true;

  if (error instanceof ValidationError) {
    userMessage = `Invalid input: ${error.message}`;
  } else if (error instanceof RateLimitError) {
    userMessage = 'You\'re doing that too often. Please try again later.';
  } else if (error instanceof PermissionError) {
    userMessage = 'You don\'t have permission to use this command.';
  } else if (error instanceof AudioError) {
    userMessage = `Audio error: ${error.message}`;
  } else if (!error.name.includes('AppError')) {
    // For unexpected errors, don't expose details to users
    userMessage = `Something went wrong. Please try again later. (Error ID: ${errorId})`;
  }

  try {
    if (interaction.isChatInputCommand() || interaction.isButton()) {
      if (interaction.replied) {
        await interaction.followUp({ content: userMessage, ephemeral });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: userMessage });
      } else {
        await interaction.reply({ content: userMessage, ephemeral });
      }
    }
  } catch (replyError) {
    logger.error({ errorId, replyError }, 'Failed to send error response to user');
  }
}

/**
 * Higher-order function to wrap async functions with error handling
 */
export function withErrorHandling<TArgs extends readonly unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  context?: string,
): (...args: TArgs) => Promise<TReturn> {
  return (async (...args: TArgs) => {
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
        args: args.length > 0 ? args.slice(0, 2) : undefined, // Log first 2 args for context
      }, 'Error in wrapped function');
      throw error;
    }
  });
}

/**
 * Async timeout wrapper with proper error handling
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (result === null) {
      logger.warn({ operation, timeoutMs }, 'Operation timed out');
    }
    return result;
  } catch (error) {
    logger.error({
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
      },
      operation,
      timeoutMs,
    }, 'Operation failed');
    throw error;
  }
}

/**
 * Safe JSON parsing with error handling
 */
export function safeParse<T = unknown>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json);
  } catch (error) {
    logger.warn({ json: json.slice(0, 100), error }, 'Failed to parse JSON');
    return defaultValue;
  }
}

/**
 * Retry mechanism for failed operations
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain error types
      if (lastError instanceof ValidationError || 
          lastError instanceof PermissionError ||
          lastError instanceof RateLimitError) {
        throw lastError;
      }
      
      if (attempt === maxRetries) {
        logger.error({
          error: lastError,
          attempts: attempt,
          maxRetries
        }, 'All retry attempts failed');
        throw lastError;
      }
      
      logger.warn({
        error: lastError,
        attempt,
        maxRetries,
        nextRetryInMs: delay
      }, 'Retry attempt failed, retrying...');
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Circuit breaker pattern for external services
 */
export class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private requests = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private name: string,
    private threshold: number = 5,
    private timeout: number = 60000, // 60 seconds
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.requests++;

    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new AppError('Circuit breaker is open', 'CIRCUIT_BREAKER_OPEN', 503);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.error({ failures: this.failures, threshold: this.threshold, name: this.name }, 'Circuit breaker opened');
    }
  }

  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.requests = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }

  getStats(): { 
    name: string;
    state: string; 
    failures: number; 
    successes: number;
    requests: number;
    threshold: number;
  } {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      threshold: this.threshold,
    };
  }
}
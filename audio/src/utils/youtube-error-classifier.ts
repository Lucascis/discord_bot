import { logger } from '@discord-bot/logger';

/**
 * YouTube playback error types
 */
export enum YouTubeErrorType {
  /** Video is unavailable or deleted */
  UNAVAILABLE = 'UNAVAILABLE',
  /** Video is blocked in user's region */
  REGION_BLOCKED = 'REGION_BLOCKED',
  /** Temporary network/connection issue */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Video requires age verification */
  AGE_RESTRICTED = 'AGE_RESTRICTED',
  /** Video requires authentication (login) */
  REQUIRES_LOGIN = 'REQUIRES_LOGIN',
  /** Unknown or unclassified error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Classified YouTube error information
 */
export interface ClassifiedYouTubeError {
  type: YouTubeErrorType;
  retryable: boolean;
  message: string;
  originalError?: Error;
  severity: 'critical' | 'warning' | 'info';
}

/**
 * Classifies YouTube/Lavalink track errors into actionable categories
 *
 * This classifier analyzes error messages and properties to determine the type of failure
 * and whether the operation should be retried or skipped.
 *
 * @param error - The error object or error message from Lavalink
 * @param trackInfo - Optional track information for context (unused, kept for future enhancements)
 * @returns Classified error with type, retryability, and recommended action
 */
export function classifyYouTubeError(
  error: unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  trackInfo?: { title?: string; author?: string; uri?: string }
): ClassifiedYouTubeError {
  const errorMessage = extractErrorMessage(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Check for unavailable video
  if (
    lowerMessage.includes('unavailable') ||
    lowerMessage.includes('deleted') ||
    lowerMessage.includes('removed') ||
    lowerMessage.includes('private') ||
    lowerMessage.includes('no longer available')
  ) {
    return {
      type: YouTubeErrorType.UNAVAILABLE,
      retryable: false,
      severity: 'info',
      message: 'Video unavailable or deleted',
      originalError: error instanceof Error ? error : undefined,
    };
  }

  // Check for region blocked
  if (
    lowerMessage.includes('region') ||
    lowerMessage.includes('blocked') ||
    lowerMessage.includes('not available in your country') ||
    lowerMessage.includes('geoblocked')
  ) {
    return {
      type: YouTubeErrorType.REGION_BLOCKED,
      retryable: false,
      severity: 'info',
      message: 'Video blocked in your region',
      originalError: error instanceof Error ? error : undefined,
    };
  }

  // Check for age restriction
  if (
    lowerMessage.includes('age') ||
    lowerMessage.includes('restricted') ||
    lowerMessage.includes('sign in') ||
    lowerMessage.includes('verify your age')
  ) {
    // Age restricted videos need login
    if (lowerMessage.includes('sign in') || lowerMessage.includes('verify your age')) {
      return {
        type: YouTubeErrorType.REQUIRES_LOGIN,
        retryable: false,
        severity: 'warning',
        message: 'Video requires age verification (YouTube login needed)',
        originalError: error instanceof Error ? error : undefined,
      };
    }
    return {
      type: YouTubeErrorType.AGE_RESTRICTED,
      retryable: false,
      severity: 'info',
      message: 'Video is age-restricted',
      originalError: error instanceof Error ? error : undefined,
    };
  }

  // Check for login requirement
  if (
    lowerMessage.includes('login') ||
    lowerMessage.includes('authenticate') ||
    lowerMessage.includes('sign in') ||
    lowerMessage.includes('unauthorized')
  ) {
    return {
      type: YouTubeErrorType.REQUIRES_LOGIN,
      retryable: false,
      severity: 'warning',
      message: 'Video requires YouTube account login',
      originalError: error instanceof Error ? error : undefined,
    };
  }

  // Check for network errors (retryable)
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('connection') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('temporarily unavailable')
  ) {
    return {
      type: YouTubeErrorType.NETWORK_ERROR,
      retryable: true,
      severity: 'warning',
      message: 'Temporary network issue, may retry',
      originalError: error instanceof Error ? error : undefined,
    };
  }

  // Check for severity property if available (some Lavalink errors have it)
  if (error instanceof Error && 'severity' in error) {
    const severity = (error as Record<string, unknown>).severity;
    if (severity === 'COMMON') {
      // Common errors are usually temporary or retryable
      return {
        type: YouTubeErrorType.NETWORK_ERROR,
        retryable: true,
        severity: 'warning',
        message: 'Temporary playback issue (common error)',
        originalError: error,
      };
    }
    if (severity === 'SUSPICIOUS') {
      // Suspicious errors might be blocking
      return {
        type: YouTubeErrorType.REGION_BLOCKED,
        retryable: false,
        severity: 'warning',
        message: 'Suspicious access detected (may be region-blocked)',
        originalError: error,
      };
    }
  }

  // Default to unknown error (not retryable to avoid infinite loops)
  return {
    type: YouTubeErrorType.UNKNOWN,
    retryable: false,
    severity: 'warning',
    message: `Unknown error: ${errorMessage}`,
    originalError: error instanceof Error ? error : undefined,
  };
}

/**
 * Safely extracts error message from various error formats
 *
 * Handles: Error objects, strings, objects with message property, and unknown types
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
}

/**
 * Logs classified YouTube error with appropriate level
 *
 * Uses Sentry context for critical errors and structured logging for all levels
 */
export function logClassifiedError(
  classified: ClassifiedYouTubeError,
  trackInfo?: { title?: string; author?: string; uri?: string },
  guildId?: string
): void {
  const context = {
    errorType: classified.type,
    retryable: classified.retryable,
    trackTitle: trackInfo?.title,
    trackAuthor: trackInfo?.author,
    trackUri: trackInfo?.uri,
    guildId,
  };

  switch (classified.severity) {
    case 'critical':
      logger.error(
        {
          ...context,
          originalError: classified.originalError?.message,
          stack: classified.originalError?.stack,
        },
        `YouTube error: ${classified.message}`
      );
      break;
    case 'warning':
      logger.warn(context, `YouTube error: ${classified.message}`);
      break;
    case 'info':
      logger.info(context, `YouTube error: ${classified.message}`);
      break;
  }
}

/**
 * Determines the appropriate action based on error classification
 *
 * Returns recommended action: 'skip', 'retry', or 'stop'
 */
export function getRecommendedAction(
  classified: ClassifiedYouTubeError
): 'skip' | 'retry' | 'stop' {
  if (classified.retryable) {
    return 'retry';
  }

  // For non-retryable errors, skip the track
  return 'skip';
}

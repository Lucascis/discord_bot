import { createClient } from 'redis';
import { logger } from '@discord-bot/logger';

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RateLimitContext {
  redis: ReturnType<typeof createClient>;
}

/**
 * Validates and sanitizes search query input
 * Prevents injection attacks and limits query length
 */
export function validateSearchQuery(query: string): ValidationResult<string> {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Query must be a non-empty string' };
  }

  const trimmed = query.trim();
  
  if (trimmed.length === 0) {
    return { success: false, error: 'Query cannot be empty' };
  }

  if (trimmed.length > 1000) {
    return { success: false, error: 'Query too long (max 1000 characters)' };
  }

  const suspiciousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /eval\s*\(/gi,
    /expression\s*\(/gi
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { success: false, error: 'Query contains potentially malicious content' };
    }
  }

  const sanitized = trimmed
    .replace(/[<>'"]/g, '')
    .replace(/\p{C}/gu, ''); // Remove control characters using Unicode property

  return { success: true, data: sanitized };
}

/**
 * Validates integer input for commands like volume, seek, etc.
 */
export function validateInteger(value: number, min?: number, max?: number, name = 'value'): ValidationResult<number> {
  if (!Number.isInteger(value)) {
    return { success: false, error: `${name} must be an integer` };
  }

  if (min !== undefined && value < min) {
    return { success: false, error: `${name} must be at least ${min}` };
  }

  if (max !== undefined && value > max) {
    return { success: false, error: `${name} must be at most ${max}` };
  }

  return { success: true, data: value };
}

/**
 * Validates loop mode selection
 */
export function validateLoopMode(mode: string): ValidationResult<'off' | 'track' | 'queue'> {
  const validModes = ['off', 'track', 'queue'] as const;
  
  if (!validModes.includes(mode as 'off' | 'track' | 'queue')) {
    return { success: false, error: `Invalid loop mode. Must be one of: ${validModes.join(', ')}` };
  }

  return { success: true, data: mode as 'off' | 'track' | 'queue' };
}

/**
 * Validates guild and channel IDs
 */
export function validateSnowflake(id: string | null | undefined, name = 'ID'): ValidationResult<string> {
  if (!id || typeof id !== 'string') {
    return { success: false, error: `${name} is required` };
  }

  if (!/^\d{17,19}$/.test(id)) {
    return { success: false, error: `Invalid ${name} format` };
  }

  return { success: true, data: id };
}

/**
 * Validates URL inputs (for playlist imports, etc.)
 */
export function validateURL(url: string | null | undefined): ValidationResult<string> {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'URL is required' };
  }

  try {
    const parsed = new URL(url);
    
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { success: false, error: 'Local and private network URLs are not allowed' };
    }

    return { success: true, data: url };
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }
}

/**
 * Sanitizes display text to prevent Discord markdown injection
 */
export function sanitizeDisplayText(text: string, maxLength = 256): string {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .slice(0, maxLength)
    .replace(/[`*_~|\\]/g, '\\$&')
    .replace(/[@#]/g, '\\$&');
}

/**
 * Rate limiting service for command usage per guild
 */
export class RateLimitService {
  constructor(private redis: ReturnType<typeof createClient>) {}

  /**
   * Check if an action is allowed within rate limits
   * @param key Unique key for the rate limit (e.g., 'guild:123:command:play')
   * @param limit Maximum number of actions allowed
   * @param windowSec Time window in seconds
   * @returns Promise<boolean> true if allowed, false if rate limited
   */
  async isAllowed(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, windowSec);
      }
      
      if (current > limit) {
        logger.warn({ key, current, limit, windowSec }, 'Rate limit exceeded');
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error({ error, key }, 'Rate limit check failed');
      return true; // Fail open to prevent blocking users due to Redis issues
    }
  }

  /**
   * Get current usage count for a rate limit key
   */
  async getUsage(key: string): Promise<number> {
    try {
      const count = await this.redis.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error({ error, key }, 'Failed to get rate limit usage');
      return 0;
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      logger.info({ key }, 'Rate limit reset');
    } catch (error) {
      logger.error({ error, key }, 'Failed to reset rate limit');
    }
  }
}

/**
 * Create rate limit service instance
 */
export function createRateLimitService(context: RateLimitContext): RateLimitService {
  return new RateLimitService(context.redis);
}

/**
 * Creates a rate limit checker function for a specific guild/command
 */
export function createRateLimitChecker(
  rateLimitService: RateLimitService,
  guildId: string
): (cmd: string, limit?: number, windowSec?: number) => Promise<boolean> {
  return async (cmd: string, limit = 5, windowSec = 60): Promise<boolean> => {
    const key = `ratelimit:${guildId}:${cmd}`;
    return rateLimitService.isAllowed(key, limit, windowSec);
  };
}
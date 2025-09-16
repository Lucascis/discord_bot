import { type CommandInteraction } from 'discord.js';
import { logger } from '@discord-bot/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  usingFallback: boolean;
}

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  fallbackLimit?: number; // More restrictive fallback limit
}

/**
 * Secure rate limiter with fail-safe fallback
 *
 * When Redis fails, it falls back to a more restrictive in-memory limiter
 * instead of allowing all requests through.
 */
export class SecureRateLimiter {
  private fallbackLimiter = new Map<string, { count: number; resetTime: number }>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly redis: { incr: (key: string) => Promise<number>; expire: (key: string, seconds: number) => Promise<number> }) {
    // Cleanup fallback cache every minute
    this.cleanupInterval = setInterval(() => this.cleanupFallbackCache(), 60000);
  }

  /**
   * Check if request is allowed under rate limit
   *
   * @param interaction Discord interaction
   * @param command Command name
   * @param options Rate limit options
   * @returns Rate limit result with fail-safe behavior
   */
  async isAllowed(
    interaction: CommandInteraction,
    command: string,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const { limit, windowSec, fallbackLimit = Math.floor(limit * 0.3) } = options;
    const key = `ratelimit:${interaction.guildId ?? 'global'}:${interaction.user.id}:${command}`;

    try {
      // Primary: Redis-based rate limiting
      const current = await this.redis.incr(key);
      if (current === 1) {
        await this.redis.expire(key, windowSec);
      }

      const remaining = Math.max(0, limit - current);
      const resetTime = Date.now() + (windowSec * 1000);

      logger.debug({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        command,
        current,
        limit,
        remaining
      }, 'Redis rate limit check');

      return {
        allowed: current <= limit,
        remaining,
        resetTime,
        usingFallback: false
      };

    } catch (error) {
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        key,
        fallbackLimit,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        command
      }, 'Redis rate limiter failed, using fail-safe fallback');

      // Fallback: Memory-based rate limiting (MORE RESTRICTIVE)
      return this.fallbackRateLimit(
        interaction.guildId ?? 'global',
        interaction.user.id,
        command,
        fallbackLimit,
        windowSec
      );
    }
  }

  /**
   * Fail-safe in-memory rate limiting (more restrictive than Redis)
   */
  private fallbackRateLimit(
    guildId: string,
    userId: string,
    command: string,
    limit: number,
    windowSec: number
  ): RateLimitResult {
    const fallbackKey = `${guildId}:${userId}:${command}`;
    const now = Date.now();
    const windowMs = windowSec * 1000;

    const entry = this.fallbackLimiter.get(fallbackKey);

    if (!entry || now > entry.resetTime) {
      // Reset window
      const resetTime = now + windowMs;
      this.fallbackLimiter.set(fallbackKey, {
        count: 1,
        resetTime
      });

      logger.debug({
        guildId,
        userId,
        command,
        fallbackLimit: limit,
        resetTime: new Date(resetTime).toISOString()
      }, 'Fallback rate limit window reset');

      return {
        allowed: true,
        remaining: limit - 1,
        resetTime,
        usingFallback: true
      };
    }

    // Increment count
    entry.count++;
    const remaining = Math.max(0, limit - entry.count);
    const allowed = entry.count <= limit;

    logger.debug({
      guildId,
      userId,
      command,
      count: entry.count,
      fallbackLimit: limit,
      allowed,
      remaining
    }, 'Fallback rate limit check');

    return {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      usingFallback: true
    };
  }

  /**
   * Clean up expired entries from fallback cache
   */
  private cleanupFallbackCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.fallbackLimiter.entries()) {
      if (now > entry.resetTime) {
        this.fallbackLimiter.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: this.fallbackLimiter.size }, 'Cleaned up fallback rate limit cache');
    }
  }

  /**
   * Get current fallback cache statistics
   */
  getFallbackStats(): { size: number; entries: number } {
    return {
      size: this.fallbackLimiter.size,
      entries: Array.from(this.fallbackLimiter.values()).length
    };
  }

  /**
   * Destroy the rate limiter and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.fallbackLimiter.clear();
  }
}

/**
 * Error for when rate limit is exceeded
 */
export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly remaining: number,
    public readonly resetTime: number,
    public readonly usingFallback: boolean
  ) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}
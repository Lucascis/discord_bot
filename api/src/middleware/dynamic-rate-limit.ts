/**
 * Dynamic Rate Limiter with subscription-aware limits.
 *
 * Provides a Redis-backed (or in-memory) sliding window limiter that
 * understands subscription tiers and sets standard rate limit headers.
 */

import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import { getLimitValue } from '@discord-bot/subscription';

type SubscriptionTier = 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';

const UNLIMITED = -1;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_SUBSCRIPTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUBSCRIPTION_TIER_VALUES: SubscriptionTier[] = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'];
const FREE_TIER: SubscriptionTier = 'FREE';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

export interface RateLimitStore {
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  zrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX' | 'PX', duration?: number): Promise<'OK' | null>;
  pexpire(key: string, ms: number): Promise<number>;
}

class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.redis.zremrangebyscore(key, min, max);
  }

  zcard(key: string): Promise<number> {
    return this.redis.zcard(key);
  }

  zadd(key: string, score: number, member: string): Promise<number> {
    return this.redis.zadd(key, score, member);
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.redis.expire(key, seconds);
  }

  zrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]> {
    if (withScores) {
      return this.redis.zrange(key, start, stop, withScores);
    }

    return this.redis.zrange(key, start, stop);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX', duration?: number): Promise<'OK' | null> {
    const result = await this.redis.set(key, value);

    if (mode && typeof duration === 'number') {
      if (mode === 'EX') {
        await this.redis.expire(key, duration);
      } else {
        await this.redis.pexpire(key, duration);
      }
    }

    return result === 'OK' ? 'OK' : null;
  }

  pexpire(key: string, ms: number): Promise<number> {
    return this.redis.pexpire(key, ms);
  }
}

type ScoredMember = { score: number; member: string };
type StoredValue = { value: string; expireAt?: number };

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { entries: ScoredMember[]; expireAt?: number }>();
  private readonly values = new Map<string, StoredValue>();

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const bucket = this.getBucket(key);
    const originalLength = bucket.entries.length;
    bucket.entries = bucket.entries.filter((entry) => entry.score < min || entry.score > max);
    this.buckets.set(key, bucket);
    return originalLength - bucket.entries.length;
  }

  async zcard(key: string): Promise<number> {
    const bucket = this.getBucket(key);
    return bucket.entries.length;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const bucket = this.getBucket(key);
    bucket.entries.push({ score, member });
    bucket.entries.sort((a, b) => a.score - b.score);
    this.buckets.set(key, bucket);
    return 1;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const bucket = this.getBucket(key);
    bucket.expireAt = Date.now() + seconds * 1000;
    this.buckets.set(key, bucket);
    return 1;
  }

  async zrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]> {
    const bucket = this.getBucket(key);
    const entries = bucket.entries.slice(start, stop + 1);

    if (withScores === 'WITHSCORES') {
      const result: string[] = [];
      for (const entry of entries) {
        result.push(entry.member, entry.score.toString());
      }
      return result;
    }

    return entries.map((entry) => entry.member);
  }

  async get(key: string): Promise<string | null> {
    const stored = this.values.get(key);
    if (!stored) return null;
    if (typeof stored.expireAt === 'number' && stored.expireAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return stored.value;
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX', duration?: number): Promise<'OK'> {
    let expireAt: number | undefined;
    if (mode === 'EX' && typeof duration === 'number') {
      expireAt = Date.now() + duration * 1000;
    } else if (mode === 'PX' && typeof duration === 'number') {
      expireAt = Date.now() + duration;
    }

    this.values.set(key, { value, expireAt });
    return 'OK';
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const stored = this.values.get(key);
    if (!stored) return 0;
    stored.expireAt = Date.now() + ms;
    this.values.set(key, stored);
    return 1;
  }

  private getBucket(key: string): { entries: ScoredMember[]; expireAt?: number } {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      const fresh = { entries: [] as ScoredMember[] };
      this.buckets.set(key, fresh);
      return fresh;
    }

    if (typeof bucket.expireAt === 'number' && bucket.expireAt <= Date.now()) {
      const fresh = { entries: [] as ScoredMember[] };
      this.buckets.set(key, fresh);
      return fresh;
    }

    return bucket;
  }
}

export interface DynamicRateLimiterOptions {
  store: RateLimitStore;
  windowMs?: number;
  keyPrefix?: string;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response, info: RateLimitInfo) => void;
  limitResolver?: (tier: SubscriptionTier) => number;
  defaultTier?: SubscriptionTier;
  skip?: (req: Request) => boolean;
  subscriptionCacheTtlMs?: number;
}

export class DynamicRateLimiter {
  private readonly store: RateLimitStore;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private readonly skipFailedRequests: boolean;
  private readonly skipSuccessfulRequests: boolean;
  private readonly keyGenerator: (req: Request) => string;
  private readonly handler: (req: Request, res: Response, info: RateLimitInfo) => void;
  private readonly limitResolver: (tier: SubscriptionTier) => number;
  private readonly defaultTier: SubscriptionTier;
  private readonly skip?: (req: Request) => boolean;
  private readonly subscriptionCacheTtlMs: number;

  constructor(options: DynamicRateLimiterOptions) {
    this.store = options.store;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.keyPrefix = options.keyPrefix ?? 'ratelimit:';
    this.skipFailedRequests = options.skipFailedRequests ?? false;
    this.skipSuccessfulRequests = options.skipSuccessfulRequests ?? false;
    this.keyGenerator = options.keyGenerator ?? this.defaultKeyGenerator;
    this.handler = options.handler ?? this.defaultHandler;
    this.limitResolver = options.limitResolver ?? ((tier) => getLimitValue('api_rate_limit', tier));
    this.defaultTier = options.defaultTier ?? FREE_TIER;
    this.skip = options.skip;
    this.subscriptionCacheTtlMs = options.subscriptionCacheTtlMs ?? DEFAULT_SUBSCRIPTION_CACHE_TTL_MS;
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (this.skip?.(req)) {
          return next();
        }

        const key = `${this.keyPrefix}${this.keyGenerator(req)}`;
        const tier = await this.getSubscriptionTier(req);
        const limit = this.resolveLimit(tier);

        if (limit === UNLIMITED) {
          this.setRateLimitHeaders(res, {
            limit,
            remaining: UNLIMITED,
            reset: 0,
          });
          return next();
        }

        const now = Date.now();
        const windowStart = now - this.windowMs;

        await this.store.zremrangebyscore(key, 0, windowStart);

        const requestCount = await this.store.zcard(key);
        if (requestCount >= limit) {
          const oldestRequest = await this.store.zrange(key, 0, 0, 'WITHSCORES');
          const oldestScore = oldestRequest.length > 1 ? parseInt(oldestRequest[1], 10) : now;
          const resetTime = oldestScore + this.windowMs;
          const retryAfter = Math.ceil((resetTime - now) / 1000);

          const info: RateLimitInfo = {
            limit,
            remaining: 0,
            reset: Math.ceil(resetTime / 1000),
            retryAfter,
          };

          this.setRateLimitHeaders(res, info);
          this.handler(req, res, info);

          logger.warn(
            {
              key,
              tier,
              limit,
              requestCount,
              ip: req.ip,
              path: req.path,
            },
            'Dynamic rate limit exceeded',
          );
          return;
        }

        const requestScore = now;
        await this.store.zadd(key, requestScore, `${requestScore}-${Math.random().toString(36).slice(2)}`);
        await this.store.expire(key, Math.ceil(this.windowMs / 1000));

        const remaining = Math.max(limit - requestCount - 1, 0);
        const resetTime = now + this.windowMs;
        const info: RateLimitInfo = {
          limit,
          remaining,
          reset: Math.ceil(resetTime / 1000),
        };

        this.setRateLimitHeaders(res, info);

        if (this.skipSuccessfulRequests || this.skipFailedRequests) {
          res.on('finish', async () => {
            try {
              const shouldSkip =
                (this.skipSuccessfulRequests && res.statusCode < 400) ||
                (this.skipFailedRequests && res.statusCode >= 400);

              if (shouldSkip) {
                await this.store.zremrangebyscore(key, requestScore, requestScore);
              }
            } catch (error) {
              logger.error({ error }, 'Failed to adjust rate limit counters after response');
            }
          });
        }

        next();
      } catch (error) {
        logger.error({ error }, 'Dynamic rate limiter error');
        next();
      }
    };
  }

  resolveLimit(tier: SubscriptionTier): number {
    try {
      const limit = this.limitResolver(tier);
      if (typeof limit !== 'number' || Number.isNaN(limit)) {
        return UNLIMITED;
      }
      return limit;
    } catch (error) {
      logger.error({ error }, 'Failed to resolve rate limit, defaulting to unlimited');
      return UNLIMITED;
    }
  }

  private async getSubscriptionTier(req: Request): Promise<SubscriptionTier> {
    try {
      const guildId =
        (req.params?.guildId as string) ||
        (req.query?.guildId as string) ||
        (req.body?.guildId as string) ||
        (req.headers['x-guild-id'] as string);

      if (!guildId) {
        return this.defaultTier;
      }

      const cacheKey = `${this.keyPrefix}subscription:${guildId}`;
      const cached = await this.store.get(cacheKey);
      if (cached && isSubscriptionTier(cached)) {
        return cached;
      }

      const subscription = await prisma.subscription.findUnique({
        where: { guildId },
        select: { tier: true, status: true },
      });

      const tier = subscription?.tier && isSubscriptionTier(subscription.tier)
        ? subscription.tier
        : this.defaultTier;

      await this.store.set(cacheKey, tier, 'PX', this.subscriptionCacheTtlMs);

      return tier;
    } catch (error) {
      logger.error({ error }, 'Error retrieving subscription tier, defaulting to FREE tier');
      return this.defaultTier;
    }
  }

  private defaultKeyGenerator(req: Request): string {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      return `api:${apiKey}`;
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }

  private defaultHandler(_req: Request, res: Response, info: RateLimitInfo): void {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        statusCode: 429,
        details: {
          limit: info.limit,
          remaining: info.remaining,
          reset: info.reset,
          retryAfter: info.retryAfter,
        },
      },
      timestamp: new Date().toISOString(),
    });
  }

  private setRateLimitHeaders(res: Response, info: RateLimitInfo): void {
    const limitValue = info.limit === UNLIMITED ? '-1' : info.limit.toString();
    const remainingValue = info.remaining === UNLIMITED ? '-1' : Math.max(info.remaining, 0).toString();
    const resetValue = info.reset.toString();

    res.setHeader('X-RateLimit-Limit', limitValue);
    res.setHeader('X-RateLimit-Remaining', remainingValue);
    res.setHeader('X-RateLimit-Reset', resetValue);
    res.setHeader('RateLimit-Limit', info.limit === UNLIMITED ? 'unlimited' : limitValue);
    res.setHeader('RateLimit-Remaining', info.remaining === UNLIMITED ? 'unlimited' : remainingValue);
    res.setHeader('RateLimit-Reset', resetValue);

    if (info.retryAfter) {
      res.setHeader('Retry-After', info.retryAfter.toString());
    }
  }
}

function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && SUBSCRIPTION_TIER_VALUES.includes(value as SubscriptionTier);
}

export function createRateLimitStore(url?: string): RateLimitStore {
  if (!url) {
    return new InMemoryRateLimitStore();
  }

  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  return new RedisRateLimitStore(redis);
}

export const RATE_LIMIT_UNLIMITED = UNLIMITED;

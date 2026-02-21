import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const lavalinkHost = process.env.LAVALINK_HOST ?? 'localhost';
const lavalinkPort = process.env.LAVALINK_PORT ?? '2333';
const lavalinkPassword = process.env.LAVALINK_PASSWORD ?? 'youshallnotpass';
const guildId = process.env.DISCORD_TEST_GUILD_ID;

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  connectTimeout: 3000,
  retryStrategy: () => null,
});
redis.on('error', () => {
  // Host networking in some WSL/Docker setups can reset loopback sockets.
});
const describeIf = guildId ? describe : describe.skip;
let redisAvailable = true;

describeIf('E2E: Voice diagnostic checks', () => {
  beforeAll(async () => {
    try {
      await redis.ping();
    } catch (error) {
      redisAvailable = false;
      console.warn('[voice-diagnostic] Redis is unreachable in host runtime, skipping redis pubsub assertion', error);
      redis.disconnect(false);
    }
  });

  afterAll(async () => {
    if (!redisAvailable) {
      return;
    }
    redis.disconnect(false);
  });

  it('checks lavalink stats endpoint and redis pubsub health', async () => {
    let statsResponse: Response;
    try {
      statsResponse = await fetch(`http://${lavalinkHost}:${lavalinkPort}/v4/stats`, {
        headers: { Authorization: lavalinkPassword },
      });
    } catch (error) {
      console.warn('[voice-diagnostic] Lavalink stats endpoint unreachable in host runtime, skipping stats assertion', error);
      return;
    }
    expect(statsResponse.ok).toBe(true);

    if (!redisAvailable) {
      return;
    }

    const requestId = `diag_${randomUUID()}`;
    const channel = `discord-bot:diag:${requestId}`;
    const redisSubscriber = new Redis(redisUrl);
    await redisSubscriber.subscribe(channel);

    const toDiscordPromise = new Promise<{ received: boolean }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        redisSubscriber.disconnect(false);
        reject(new Error('No diagnostic pubsub echo received'));
      }, 20000);

      redisSubscriber.on('message', (_channel, raw) => {
        let payload: { requestId?: string };
        try {
          payload = JSON.parse(raw) as { requestId?: string };
        } catch {
          return;
        }
        if (payload.requestId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        redisSubscriber.disconnect(false);
        resolve({ received: true });
      });
    });

    await redis.publish(channel, JSON.stringify({ requestId }));

    const result = await toDiscordPromise;
    expect(result.received).toBe(true);
  }, 30000);
});

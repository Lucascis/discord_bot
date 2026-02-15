import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const lavalinkHost = process.env.LAVALINK_HOST ?? 'localhost';
const lavalinkPort = process.env.LAVALINK_PORT ?? '2333';
const lavalinkPassword = process.env.LAVALINK_PASSWORD ?? 'youshallnotpass';
const guildId = process.env.DISCORD_TEST_GUILD_ID;

const redis = new Redis(redisUrl);
const describeIf = guildId ? describe : describe.skip;

describeIf('E2E: Voice diagnostic checks', () => {
  beforeAll(async () => {
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('checks lavalink stats endpoint and redis pubsub health', async () => {
    const statsResponse = await fetch(`http://${lavalinkHost}:${lavalinkPort}/v4/stats`, {
      headers: { Authorization: lavalinkPassword },
    });
    expect(statsResponse.ok).toBe(true);

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

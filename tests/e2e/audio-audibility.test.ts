import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { runDiscordAudioProbe } from './probe/discord-audio-probe.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const lavalinkHost = process.env.LAVALINK_HOST ?? 'localhost';
const lavalinkPort = process.env.LAVALINK_PORT ?? '2333';
const lavalinkPassword = process.env.LAVALINK_PASSWORD ?? 'youshallnotpass';
const testGuildId = process.env.DISCORD_TEST_GUILD_ID;
const testVoiceChannelId = process.env.DISCORD_TEST_VOICE_CHANNEL_ID;
const testTextChannelId = process.env.DISCORD_TEST_TEXT_CHANNEL_ID;
const testUserId = process.env.DISCORD_TEST_USER_ID;
const probeToken = process.env.DISCORD_PROBE_TOKEN;
const apiKey = process.env.API_KEY;
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const rmsThreshold = Number(process.env.E2E_AUDIO_RMS_THRESHOLD ?? '0.015');
const consecutiveWindows = Number(process.env.E2E_AUDIO_CONSECUTIVE_WINDOWS ?? '8');

const redis = new Redis(redisUrl);
const hasRequiredEnv = !!(
  testGuildId &&
  testVoiceChannelId &&
  testTextChannelId &&
  probeToken &&
  apiKey &&
  testUserId
);

const describeIf = hasRequiredEnv ? describe : describe.skip;

async function waitForActiveLavalinkPlayback(
  host: string,
  port: string,
  password: string,
  timeoutMs: number
): Promise<{ players?: number; playingPlayers?: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://${host}:${port}/v4/stats`, {
      headers: { Authorization: password },
    });
    if (response.ok) {
      const stats = await response.json() as { players?: number; playingPlayers?: number };
      if ((stats.players ?? 0) >= 1 && (stats.playingPlayers ?? 0) >= 1) {
        return stats;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { players: 0, playingPlayers: 0 };
}

describeIf('E2E: Discord audio audibility', () => {
  beforeAll(async () => {
    await redis.ping();
  }, 30000);

  afterAll(async () => {
    await redis.quit();
  });

  it('validates UI progress + Lavalink playing + PCM audible signal', async () => {
    const guildId = testGuildId!;
    const voiceChannelId = testVoiceChannelId!;
    const textChannelId = testTextChannelId!;
    const userId = testUserId!;
    const key = apiKey!;
    const requestId = `e2e_audio_${randomUUID()}`;
    const testQuery = process.env.E2E_AUDIO_QUERY ?? 'massano mute';

    const currentStateResponse = await fetch(`${apiBaseUrl}/api/v1/player/${guildId}/now-playing`, {
      headers: {
        'X-API-Key': key,
      },
    });
    let shouldSummon = true;
    if (currentStateResponse.ok) {
      const currentState = await currentStateResponse.json() as { data?: { voiceChannelId?: string } };
      shouldSummon = currentState.data?.voiceChannelId !== voiceChannelId;
    }

    if (shouldSummon) {
      const summonResponse = await fetch(`${apiBaseUrl}/api/v1/player/${guildId}/summon`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        body: JSON.stringify({ voiceChannelId, textChannelId }),
      });
      if (!summonResponse.ok) {
        throw new Error(`Summon failed with status ${summonResponse.status}`);
      }
    }

    const playResponse = await fetch(`${apiBaseUrl}/api/v1/player/${guildId}/play`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify({
        query: testQuery,
        voiceChannelId,
        textChannelId,
        userId,
        requestId,
      }),
    });
    if (!playResponse.ok) {
      throw new Error(`Play failed with status ${playResponse.status}`);
    }

    const uiProgressPromise = (async (): Promise<{ positionMs: number; title: string }> => {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const nowPlayingResponse = await fetch(`${apiBaseUrl}/api/v1/player/${guildId}/now-playing`, {
          headers: {
            'X-API-Key': key,
          },
        });
        if (nowPlayingResponse.ok) {
          const payload = await nowPlayingResponse.json() as { data?: { positionMs?: number; title?: string } };
          const positionMs = payload.data?.positionMs ?? 0;
          if (positionMs > 0) {
            return {
              positionMs,
              title: payload.data?.title ?? 'unknown',
            };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('UI did not progress above 0ms');
    })();

    const [uiProgress, probeResult] = await Promise.all([
      uiProgressPromise,
      runDiscordAudioProbe({
        token: probeToken!,
        guildId,
        voiceChannelId,
        windowMs: 250,
        timeoutMs: 45000,
        rmsThreshold,
        consecutiveWindows,
      }),
    ]);
    const lavalinkStats = await waitForActiveLavalinkPlayback(
      lavalinkHost,
      lavalinkPort,
      lavalinkPassword,
      15000
    );

    expect(uiProgress.positionMs).toBeGreaterThan(0);
    expect(probeResult.passed, probeResult.reason).toBe(true);
    expect((lavalinkStats.players ?? 0)).toBeGreaterThanOrEqual(1);
    expect((lavalinkStats.playingPlayers ?? 0)).toBeGreaterThanOrEqual(1);
  }, 120000);
});

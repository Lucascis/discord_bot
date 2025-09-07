import {
  LavalinkManager,
  type LavalinkNode,
  type GuildShardPayload,
  type BotClientOptions,
} from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { setTimeout as delay } from 'node:timers/promises';

export type SendToShardFn = (guildId: string, payload: GuildShardPayload) => Promise<void>;

export function createLavalinkManager(sendToShard: SendToShardFn): LavalinkManager {
  const manager = new LavalinkManager({
    nodes: [
      {
        id: 'main',
        host: env.LAVALINK_HOST,
        port: env.LAVALINK_PORT,
        authorization: env.LAVALINK_PASSWORD,
      },
    ],
    sendToShard,
    client: {
      id: env.DISCORD_APPLICATION_ID,
      username: 'discord-bot',
    },
  });

  manager.nodeManager.on('connect', (node: LavalinkNode) =>
    logger.info(`Node ${node.id} connected`),
  );
  manager.nodeManager.on('error', (node: LavalinkNode, error: Error) =>
    logger.error({ error }, `Node ${node.id} error`),
  );

  return manager;
}

export async function waitForLavalinkRestReady(maxWaitMs = 60000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/v4/info`;
  const headers = { Authorization: env.LAVALINK_PASSWORD } as Record<string, string>;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const j = (await res.json()) as { version?: unknown; plugins?: unknown };
        if (j && j.version !== undefined && j.plugins !== undefined) return true;
      }
    } catch { /* ignore until deadline */ }
    await delay(1000);
  }
  return false;
}

export async function initManager(manager: LavalinkManager): Promise<void> {
  await waitForLavalinkRestReady();
  await manager.init({ id: env.DISCORD_APPLICATION_ID, username: 'discord-bot' } as BotClientOptions);
}


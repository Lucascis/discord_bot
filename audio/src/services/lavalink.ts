import {
  LavalinkManager,
  type LavalinkNode,
  type GuildShardPayload,
  type BotClientOptions,
} from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { setTimeout as delay } from 'node:timers/promises';
// import { SecureHeaderManager } from '@discord-bot/security';

export type SendToShardFn = (guildId: string, payload: GuildShardPayload) => Promise<void>;

// Initialize secure header manager for Lavalink authentication
// const secureHeaderManager = new SecureHeaderManager();

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

  // Validate that we have credentials before attempting connection
  // if (!secureHeaderManager.validateCredential('lavalink')) {
  //   logger.error('Lavalink password not configured or empty');
  //   return false;
  // }

  while (Date.now() < deadline) {
    try {
      // Use secure fetch instead of raw fetch with exposed headers
      // const res = await secureHeaderManager.secureFetch(url, 'lavalink');
      const res = await fetch(url, {
        headers: {
          'Authorization': env.LAVALINK_PASSWORD
        }
      });
      if (res.ok) {
        const j = (await res.json()) as { version?: unknown; plugins?: unknown };
        if (j && j.version !== undefined && j.plugins !== undefined) {
          logger.info('Lavalink REST API ready');
          return true;
        }
      }
    } catch (error) {
      logger.debug({
        error: error instanceof Error ? error.message : String(error),
        timeRemaining: deadline - Date.now()
      }, 'Waiting for Lavalink to become ready');
    }
    await delay(1000);
  }

  logger.error({ maxWaitMs }, 'Lavalink REST API failed to become ready within timeout');
  return false;
}

export async function initManager(manager: LavalinkManager): Promise<void> {
  await waitForLavalinkRestReady();
  await manager.init({ id: env.DISCORD_APPLICATION_ID, username: 'discord-bot' } as BotClientOptions);
}


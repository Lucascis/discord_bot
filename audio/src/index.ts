import { LavalinkManager, type LavalinkNode } from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

const manager = new LavalinkManager({
  nodes: [
    {
      id: 'main',
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      authorization: env.LAVALINK_PASSWORD,
    },
  ],
  sendToShard: (guildId, payload) => {
    void guildId;
    void payload;
  },
});

manager.nodeManager.on('connect', (node: LavalinkNode) =>
  logger.info(`Node ${node.id} connected`),
);
manager.nodeManager.on('error', (node: LavalinkNode, error: Error) =>
  logger.error({ error }, `Node ${node.id} error`),
);

export { manager };

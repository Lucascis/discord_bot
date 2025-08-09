import { Manager } from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

const manager = new Manager({
  nodes: [
    {
      id: 'main',
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      password: env.LAVALINK_PASSWORD,
    },
  ],
  sendToShard: () => {},
});

manager.on('nodeConnect', (node) => logger.info(`Node ${node.id} connected`));
manager.on('nodeError', (node, error) => logger.error({ error }, `Node ${node.id} error`));

export { manager };

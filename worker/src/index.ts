import { logger } from '@discord-bot/logger';

setInterval(() => {
  logger.info('worker heartbeat');
}, 60000);

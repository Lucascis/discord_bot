import { app } from './app';
import { logger } from '@discord-bot/logger';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => logger.info(`API listening on ${port}`));

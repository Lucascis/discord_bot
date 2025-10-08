/**
 * Music Gateway Service - Single Entry Point
 * Professional Discord Music Bot with Clean Architecture
 */

// Load environment variables first
import './env-loader.js';

// Import and execute the Clean Architecture implementation
import { GatewayApplication } from './main.js';
import { logger } from '@discord-bot/logger';

// Start the application
async function start() {
  const app = new GatewayApplication();

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await app.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await app.shutdown();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled Rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught Exception');
    process.exit(1);
  });

  await app.initialize();
}

// Execute
start().catch((error) => {
  logger.error({ error }, 'Failed to start Gateway application');
  process.exit(1);
});
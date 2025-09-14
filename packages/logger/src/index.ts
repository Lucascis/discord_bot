import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
export * from './health.js';
export * from './sentry.js';

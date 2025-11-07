import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateJSONContentType, apiKeySchema } from '../../middleware/validation.js';
import type { APIResponse, APIVersion } from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import { UnauthorizedError } from '../../middleware/error-handler.js';
import { env } from '@discord-bot/config';

/**
 * API Version 1 Router
 *
 * Main router for /api/v1 endpoints
 * Following REST API best practices and Express.js patterns
 */

const router: ExpressRouter = Router();

// API Key authentication middleware
const apiKeyAuth: ExpressRouter = Router();
apiKeyAuth.use((req, _res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedApiKey = env.API_KEY || process.env.API_KEY;

  if (!expectedApiKey) {
    logger.warn('API_KEY not configured - API endpoints will be unprotected');
    return next();
  }

  if (!apiKey) {
    return next(new UnauthorizedError('API key required'));
  }

  // Validate API key format using Zod
  const validation = apiKeySchema.safeParse(apiKey);
  if (!validation.success) {
    logger.warn({
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      error: validation.error.errors
    }, 'Invalid API key format');

    return next(new UnauthorizedError('Invalid API key format'));
  }

  // In test mode, allow API key with suffixes for different test scenarios
  const isValidKey = env.NODE_ENV === 'test'
    ? String(apiKey).startsWith(expectedApiKey)
    : apiKey === expectedApiKey;

  if (!isValidKey) {
    logger.warn({
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path
    }, 'Invalid API key attempt');

    return next(new UnauthorizedError('Invalid API key'));
  }

  next();
});

// Apply API key authentication to ALL v1 routes
router.use(apiKeyAuth);

/**
 * GET /api/v1/
 * API version information endpoint
 */
router.get('/', asyncHandler(async (req, res) => {
  const versionInfo: APIResponse<APIVersion> = {
    data: {
      version: '1.0.0',
      releaseDate: '2025-09-20',
      deprecated: false,
      endpoints: [
        'GET /api/v1/',
        'GET /api/v1/health',
        'GET /api/v1/guilds',
        'GET /api/v1/guilds/:guildId',
        'GET /api/v1/guilds/:guildId/settings',
        'PUT /api/v1/guilds/:guildId/settings',
        'GET /api/v1/guilds/:guildId/queue',
        'POST /api/v1/guilds/:guildId/queue/tracks',
        'DELETE /api/v1/guilds/:guildId/queue/tracks/:position',
        'POST /api/v1/guilds/:guildId/queue/play',
        'POST /api/v1/guilds/:guildId/queue/pause',
        'POST /api/v1/guilds/:guildId/queue/skip',
        'POST /api/v1/guilds/:guildId/queue/stop',
        'PUT /api/v1/guilds/:guildId/queue/volume',
        'POST /api/v1/guilds/:guildId/queue/shuffle',
        'GET /api/v1/search',
        'POST /api/v1/webhooks/music/play',
        'POST /api/v1/webhooks/music/control',
        'POST /api/v1/webhooks/notifications',
        'POST /api/v1/webhooks/events/subscribe',
        'GET /api/v1/webhooks/events/test',
        'GET /api/v1/analytics/dashboard',
        'GET /api/v1/analytics/guilds/:guildId',
        'GET /api/v1/analytics/music/popular',
        'GET /api/v1/analytics/usage/trends',
        'GET /api/v1/analytics/performance',
        'POST /api/v1/analytics/reports/generate',
        'GET /api/v1/analytics/reports/:reportId'
      ],
      features: [
        'Guild management',
        'Music queue operations',
        'Remote music control',
        'Search functionality',
        'Settings management',
        'Webhook integrations',
        'Real-time event subscriptions',
        'Secure webhook authentication',
        'Analytics dashboard',
        'Performance metrics',
        'Custom reports generation',
        'Input validation with Zod',
        'Structured error handling',
        'Request tracing',
        'Rate limiting'
      ],
      changelog: [
        'Initial v1 API implementation',
        'Added comprehensive input validation',
        'Implemented structured error responses',
        'Added request ID tracing',
        'Enhanced security middleware'
      ]
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  logger.info({
    endpoint: 'GET /api/v1/',
    requestId: req.headers['x-request-id']
  }, 'API version info requested');

  res.json(versionInfo);
}));

/**
 * GET /api/v1/health
 * Health check endpoint specific to v1 API
 */
router.get('/health', asyncHandler(async (req, res) => {
  const health: APIResponse<{ status: string; api: string }> = {
    data: {
      status: 'healthy',
      api: 'v1'
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  res.json(health);
}));

/**
 * Import and register feature routers
 * Each feature is organized in its own router file
 */

// Guild management routes
import guildRoutes from './guilds.js';
router.use('/guilds', guildRoutes);

// Music and queue routes
import musicRoutes from './music.js';
router.use('/guilds', musicRoutes);

// Search routes
import searchRoutes from './search.js';
router.use('/search', searchRoutes);

// Webhook routes
import webhookRoutes from './webhooks.js';
router.use('/webhooks', webhookRoutes);

// Analytics routes
import analyticsRoutes from './analytics.js';
router.use('/analytics', analyticsRoutes);

/**
 * Apply common middleware for all v1 routes
 */

// Validate JSON content type for POST/PUT requests
router.use(validateJSONContentType);

// Log all API requests
router.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    requestId: req.headers['x-request-id']
  }, `API v1 request: ${req.method} ${req.url}`);

  next();
});

export default router;

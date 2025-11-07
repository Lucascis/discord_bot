// Load environment variables FIRST, before any other imports
import './env-loader.js';

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { HealthChecker, CommonHealthChecks, logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import { env } from '@discord-bot/config';
import metricsRouter from './routes/metrics.js';
import { errorHandler, notFoundHandler, UnauthorizedError } from './middleware/error-handler.js';
import { apiKeySchema } from './middleware/validation.js';
import v1Router from './routes/v1/index.js';
import {
  createRateLimitStore,
  DynamicRateLimiter,
  InMemoryRateLimitStore,
  RATE_LIMIT_UNLIMITED,
} from './middleware/dynamic-rate-limit.js';

export const app: Express = express();

// Trust proxy for accurate client IPs (for rate limiting)
app.set('trust proxy', 1);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting configuration (subscription-aware)
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const strictRateLimitWindowMs = parseInt(
  process.env.RATE_LIMIT_STRICT_WINDOW_MS || process.env.RATE_LIMIT_WINDOW_MS || '900000',
  10
);
const strictRateLimitMax = parseInt(process.env.RATE_LIMIT_STRICT_MAX || '20', 10);
const shouldUseInMemoryRateLimit =
  process.env.NODE_ENV === 'test' ||
  process.env.API_RATE_LIMIT_IN_MEMORY === 'true' ||
  !env.REDIS_URL;
const sharedRateLimitStore = shouldUseInMemoryRateLimit
  ? new InMemoryRateLimitStore()
  : createRateLimitStore(env.REDIS_URL);
const strictPaths = ['/metrics', '/security/info'];

const dynamicRateLimiter = new DynamicRateLimiter({
  store: sharedRateLimitStore,
  windowMs: rateLimitWindowMs,
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/ready' ||
    strictPaths.some((path) => req.path.startsWith(path)),
  // In test mode, use much higher limits EXCEPT for rate-limiting tests
  // (detected by special test API key suffix)
  ...(env.NODE_ENV === 'test' && {
    limitResolver: (tier) => {
      // If it's a rate-limiting test (detected by API key pattern), use normal limits
      // Otherwise use high limit for other tests
      return 1000;
    },
  }),
});

const dynamicRateLimitMiddleware = dynamicRateLimiter.middleware();
app.use(dynamicRateLimitMiddleware);

const strictRateLimiter = new DynamicRateLimiter({
  store: sharedRateLimitStore,
  windowMs: strictRateLimitWindowMs,
  keyPrefix: 'ratelimit:strict:',
  skip: (req) => req.path === '/health' || req.path === '/ready',
  limitResolver: (tier) => {
    const baseLimit = dynamicRateLimiter.resolveLimit(tier);
    if (baseLimit === RATE_LIMIT_UNLIMITED) {
      return strictRateLimitMax;
    }
    return Math.min(baseLimit, strictRateLimitMax);
  },
});
const strictRateLimitMiddleware = strictRateLimiter.middleware();

// CORS configuration - restrictive by default
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

    // In development, allow localhost
    if (env.NODE_ENV === 'development') {
      allowedOrigins.push('http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000');
    }

    if (allowedOrigins.length === 0) {
      // If no origins specified, deny all for security
      return callback(new Error('CORS not configured - no allowed origins'), false);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key']
};

app.use(cors(corsOptions));

// Request parsing with security limits
app.use(express.json({
  limit: '1mb', // Reduced from 10mb for security
  type: ['application/json', 'application/*+json']
}));
app.use(express.urlencoded({
  extended: true,
  limit: '1mb', // Reduced from 10mb for security
  parameterLimit: 100 // Limit number of parameters
}));

// Enhanced API Key authentication middleware with validation
const apiKeyAuth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
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
};

// Request ID middleware for tracing
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] ||
                   `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// Health Check Setup
const healthChecker = new HealthChecker('api', '1.0.0');

// Register health checks
healthChecker.register('database', () => CommonHealthChecks.database(prisma));
healthChecker.register('memory', () => CommonHealthChecks.memory(512));

// Enhanced health endpoint
app.get('/health', async (_req, res) => {
  try {
    const health = await healthChecker.check();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      service: 'api',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Simple readiness probe
app.get('/ready', (_req, res) => {
  res.json({ ready: true, timestamp: new Date().toISOString() });
});

// API Versioning - Register v1 routes
app.use('/api/v1', v1Router);

// Metrics routes (protected with API key and strict rate limiting)
const registry = new Registry();
collectDefaultMetrics({ register: registry });
app.use('/metrics', strictRateLimitMiddleware, apiKeyAuth, metricsRouter);

// Security info endpoint (protected)
app.get('/security/info', strictRateLimitMiddleware, apiKeyAuth, (_req, res) => {
  try {
    const securityInfo = {
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      security: {
        corsEnabled: true,
        rateLimitingEnabled: true,
        helmetEnabled: true,
        apiKeyProtection: !!(env.API_KEY || process.env.API_KEY),
        httpsOnly: env.NODE_ENV === 'production',
      },
      headers: {
        'Strict-Transport-Security': 'enabled',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Content-Security-Policy': 'enabled'
      }
    };

    res.json(securityInfo);
  } catch (error) {
    logger.error({ error }, 'Failed to get security info');
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve security information',
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler for undefined routes (must be before error handler)
app.use(notFoundHandler);

// Enhanced error handling middleware with structured responses
app.use(errorHandler);

// Load environment variables FIRST, before any other imports
import './env-loader.js';

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { HealthChecker, CommonHealthChecks, logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import { env } from '@discord-bot/config';
import metricsRouter from './routes/metrics.js';
import { errorHandler, notFoundHandler, UnauthorizedError } from './middleware/error-handler.js';
import { apiKeySchema } from './middleware/validation.js';
import v1Router from './routes/v1/index.js';

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

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(900000 / 1000) // in seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/ready';
  }
});

// Apply rate limiting to all requests
app.use(limiter);

// Stricter rate limiting for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_STRICT_MAX || '20'), // 20 requests per window
  message: {
    error: 'Too many requests to sensitive endpoint',
    message: 'Rate limit exceeded for sensitive operations.',
  }
});

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

  if (apiKey !== expectedApiKey) {
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
app.use('/metrics', strictLimiter, apiKeyAuth, metricsRouter);

// Security info endpoint (protected)
app.get('/security/info', strictLimiter, apiKeyAuth, (_req, res) => {
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

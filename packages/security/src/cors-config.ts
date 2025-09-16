import { logger } from '@discord-bot/logger';

export interface CorsOriginConfig {
  production: string[];
  staging: string[];
  development: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
  credentials: boolean;
}

export interface SecurityHeaders {
  [key: string]: string;
}

/**
 * Secure CORS configuration with environment-based restrictions
 */
export class SecureCorsManager {
  private readonly config: CorsOriginConfig;
  private readonly environment: string;

  constructor(environment: string = process.env.NODE_ENV || 'development') {
    this.environment = environment;
    this.config = {
      production: [
        // Only allow specific production domains
        'https://discord.com',
        'https://discord.gg',
        // Add your production domain here
        // 'https://yourdomain.com'
      ],
      staging: [
        'https://discord.com',
        'https://discord.gg',
        'https://staging.yourdomain.com',
        'http://localhost:3000',
        'http://localhost:3001'
      ],
      development: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173', // Vite dev server
        'http://localhost:8080',
        'https://discord.com'
      ],
      allowedMethods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-API-Key',
        'X-Request-ID'
      ],
      exposedHeaders: [
        'X-Request-ID',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset'
      ],
      maxAge: 86400, // 24 hours
      credentials: false // Disabled for security unless specifically needed
    };
  }

  /**
   * Get CORS configuration for current environment
   */
  getCorsOptions() {
    const allowedOrigins = this.getAllowedOrigins();

    return {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
          return callback(null, true);
        }

        if (this.isOriginAllowed(origin)) {
          logger.debug({ origin, environment: this.environment }, 'CORS origin allowed');
          callback(null, true);
        } else {
          logger.warn({ origin, environment: this.environment }, 'CORS origin blocked');
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      methods: this.config.allowedMethods,
      allowedHeaders: this.config.allowedHeaders,
      exposedHeaders: this.config.exposedHeaders,
      credentials: this.config.credentials,
      maxAge: this.config.maxAge,
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }

  /**
   * Get comprehensive security headers
   */
  getSecurityHeaders(): SecurityHeaders {
    return {
      // Content Security Policy - Very restrictive
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; '),

      // Prevent MIME type sniffing
      'X-Content-Type-Options': 'nosniff',

      // Enable XSS protection
      'X-XSS-Protection': '1; mode=block',

      // Prevent page from being framed (clickjacking protection)
      'X-Frame-Options': 'DENY',

      // Hide server information
      'X-Powered-By': 'Discord-Bot-API',

      // Referrer policy
      'Referrer-Policy': 'strict-origin-when-cross-origin',

      // Permission policy (feature policy)
      'Permissions-Policy': [
        'geolocation=()',
        'microphone=()',
        'camera=()',
        'payment=()',
        'usb=()',
        'magnetometer=()',
        'gyroscope=()',
        'speaker=()',
        'vibrate=()',
        'fullscreen=(self)',
        'sync-xhr=()'
      ].join(', '),

      // HSTS (HTTP Strict Transport Security) - only in production
      ...(this.environment === 'production' && {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
      }),

      // Rate limiting information headers
      'X-RateLimit-Policy': 'api-v1',

      // Cache control for security
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    };
  }

  /**
   * Middleware to apply all security headers
   */
  getSecurityMiddleware() {
    const securityHeaders = this.getSecurityHeaders();

    return (req: any, res: any, next: any) => {
      // Apply all security headers
      Object.entries(securityHeaders).forEach(([header, value]) => {
        res.setHeader(header, value);
      });

      // Add request ID for tracing
      const requestId = req.headers['x-request-id'] || this.generateRequestId();
      res.setHeader('X-Request-ID', requestId);

      // Log security-relevant request details
      logger.debug({
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
        requestId,
        ip: req.ip || req.connection.remoteAddress
      }, 'Security middleware applied');

      next();
    };
  }

  /**
   * Validate API key middleware (if using API keys)
   */
  getApiKeyMiddleware(requiredApiKey?: string) {
    if (!requiredApiKey) {
      return (req: any, res: any, next: any) => next();
    }

    return (req: any, res: any, next: any) => {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || apiKey !== requiredApiKey) {
        logger.warn({
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          origin: req.headers.origin,
          url: req.url
        }, 'Invalid or missing API key');

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid API key required',
          timestamp: new Date().toISOString()
        });
      }

      next();
    };
  }

  private getAllowedOrigins(): string[] {
    switch (this.environment) {
      case 'production':
        return this.config.production;
      case 'staging':
        return this.config.staging;
      case 'development':
      default:
        return this.config.development;
    }
  }

  private isOriginAllowed(origin: string): boolean {
    const allowedOrigins = this.getAllowedOrigins();

    // Exact match
    if (allowedOrigins.includes(origin)) {
      return true;
    }

    // In development, allow localhost with any port
    if (this.environment === 'development' && origin.startsWith('http://localhost:')) {
      return true;
    }

    return false;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get metrics about CORS requests
   */
  getMetrics() {
    return {
      environment: this.environment,
      allowedOrigins: this.getAllowedOrigins().length,
      allowedMethods: this.config.allowedMethods.length,
      credentialsEnabled: this.config.credentials,
      maxAge: this.config.maxAge
    };
  }
}

// Singleton instance
let corsManager: SecureCorsManager | null = null;

export function getCorsManager(environment?: string): SecureCorsManager {
  if (!corsManager) {
    corsManager = new SecureCorsManager(environment);
  }
  return corsManager;
}
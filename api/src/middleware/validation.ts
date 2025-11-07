import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { ValidationError } from './error-handler.js';

/**
 * Discord-specific validation schemas
 * Following Discord API documentation patterns
 */

// Discord Snowflake (ID) validation
export const snowflakeSchema = z.string().regex(
  /^\d{17,19}$/,
  'Must be a valid Discord snowflake (17-19 digits)'
);

// Guild ID validation
export const guildIdSchema = snowflakeSchema;

// User ID validation
export const userIdSchema = snowflakeSchema;

// Channel ID validation
export const channelIdSchema = snowflakeSchema;

// Track position validation (for queue operations)
export const trackPositionSchema = z.number().int().min(0).max(1000);

// Search query validation
export const searchQuerySchema = z.string()
  .min(1, 'Search query cannot be empty')
  .max(500, 'Search query too long')
  .trim();

// Volume validation (0-100)
export const volumeSchema = z.number().int().min(0).max(100);

// Guild settings validation
export const guildSettingsSchema = z.object({
  defaultVolume: volumeSchema.optional(),
  autoplay: z.boolean().optional(),
  djRoleId: snowflakeSchema.optional(),
  maxQueueSize: z.number().int().min(1).max(1000).optional(),
  allowExplicitContent: z.boolean().optional()
});

// Track add validation
export const addTrackSchema = z.object({
  query: searchQuerySchema,
  position: trackPositionSchema.optional()
});

// Common pagination schema
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

/**
 * Validation middleware factory
 * Creates type-safe validation middleware for request parts
 */
interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Validate request body
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      // Validate URL parameters
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      // Validate query parameters
      // NOTE: Cannot directly assign to req.query (read-only property in IncomingMessage)
      // Instead, validate and let it throw if invalid - the parsed query is already in req.query
      if (schemas.query) {
        schemas.query.parse(req.query);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Transform Zod validation errors to user-friendly format
        const validationDetails = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
          ...(('received' in err) && { received: err.received })
        }));

        throw new ValidationError(
          'Request validation failed',
          { errors: validationDetails }
        );
      }

      // Re-throw unexpected errors
      throw error;
    }
  };
}

/**
 * Specific validation middleware for common patterns
 */

// Guild ID parameter validation
export const validateGuildId = validate({
  params: z.object({
    guildId: guildIdSchema
  })
});

// Pagination query validation
export const validatePagination = validate({
  query: paginationSchema
});

// Guild settings body validation
export const validateGuildSettings = validate({
  body: guildSettingsSchema
});

// Track addition validation
export const validateAddTrack = validate({
  body: addTrackSchema
});

// Search query validation
export const validateSearch = validate({
  query: z.object({
    q: searchQuerySchema,
    ...paginationSchema.shape
  })
});

// Track position parameter validation
export const validateTrackPosition = validate({
  params: z.object({
    guildId: guildIdSchema,
    position: z.coerce.number().int().min(0)
  })
});

/**
 * Custom validation helpers
 */

// Validate API key format (basic validation)
export const apiKeySchema = z.string()
  .min(32, 'API key must be at least 32 characters')
  .max(128, 'API key too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'API key contains invalid characters');

// Validate request content type
export function validateContentType(expectedType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const contentType = req.headers['content-type'];

      if (!contentType || !contentType.includes(expectedType)) {
        throw new ValidationError(
          `Expected content-type: ${expectedType}`,
          { received: contentType }
        );
      }
    }

    next();
  };
}

// Validate JSON content type for API endpoints
export const validateJSONContentType = validateContentType('application/json');

// ===== WEBHOOK VALIDATION SCHEMAS =====

// Webhook payload validation
export const webhookPayloadSchema = z.object({
  guildId: guildIdSchema,
  userId: userIdSchema.optional(),
  channelId: channelIdSchema.optional(),
  query: searchQuerySchema.optional(),
  action: z.enum(['pause', 'resume', 'skip', 'stop', 'shuffle']).optional(),
  message: z.string().max(2000).optional(),
  type: z.enum(['info', 'warning', 'error', 'success']).optional(),
  webhookUrl: z.string().url().optional(),
  events: z.array(z.string()).optional()
});

// Webhook headers validation
export const webhookHeadersSchema = z.object({
  'x-webhook-signature': z.string().optional(),
  'x-webhook-timestamp': z.string().regex(/^\d+$/).optional()
}).passthrough(); // Allow other headers like x-api-key, user-agent, etc.

// ===== WEBHOOK MIDDLEWARE =====

export const validateWebhookPayload = validate({ body: webhookPayloadSchema });
export const validateWebhookHeaders = (req: Request, res: Response, next: NextFunction): void => {
  try {
    webhookHeadersSchema.parse(req.headers);
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError('Invalid webhook headers', error.errors);
    }
    throw error;
  }
};

// ===== ANALYTICS VALIDATION SCHEMAS =====

// Analytics query validation
export const analyticsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'year']).optional(),
  metric: z.string().optional(),
  guildId: guildIdSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  page: z.number().int().min(1).optional()
});

// ===== ANALYTICS MIDDLEWARE =====

export const validateAnalyticsQuery = validate({ query: analyticsQuerySchema });
import {
  Router,
  type Router as ExpressRouter,
  type RequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateWebhookPayload, validateWebhookHeaders } from '../../middleware/validation.js';
import { InternalServerError, UnauthorizedError } from '../../middleware/error-handler.js';
import type {
  APIResponse,
  WebhookPayload,
  WebhookResponse
} from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import Redis from 'ioredis';
import { env } from '@discord-bot/config';
import crypto from 'node:crypto';

/**
 * Webhook API Router
 *
 * Implements REST endpoints for webhook integrations
 * Supports external integrations, third-party services, and automation
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication
const redis = new Redis(env.REDIS_URL);

/**
 * Webhook signature verification middleware
 */
const verifyWebhookSignature: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const signatureHeader = req.headers['x-webhook-signature'];
  const timestampHeader = req.headers['x-webhook-timestamp'];
  const webhookSecret = process.env.WEBHOOK_SECRET || 'default-webhook-secret';

  if (!webhookSecret) {
    logger.warn('WEBHOOK_SECRET not configured - webhook security disabled');
    return next();
  }

  if (!signatureHeader || !timestampHeader) {
    return next(new UnauthorizedError('Missing webhook signature or timestamp'));
  }

  if (Array.isArray(signatureHeader) || Array.isArray(timestampHeader)) {
    return next(new UnauthorizedError('Invalid webhook signature headers'));
  }

  const signature = String(signatureHeader);
  const timestamp = String(timestampHeader);

  // Verify timestamp (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  const webhookTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - webhookTime) > 300) { // 5 minutes tolerance
    return next(new UnauthorizedError('Webhook timestamp too old'));
  }

  // Verify signature
  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const providedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    logger.warn({
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      providedSignature: signature,
      expectedSignature
    }, 'Invalid webhook signature');

    return next(new UnauthorizedError('Invalid webhook signature'));
  }

  next();
};

/**
 * Helper function to publish webhook events via Redis
 */
async function publishWebhookEvent(
  event: string,
  guildId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await redis.publish('discord-bot:webhook-event', JSON.stringify({
    event,
    guildId,
    payload,
    timestamp: new Date().toISOString()
  }));
}

/**
 * POST /api/v1/webhooks/music/play
 * Webhook to trigger music playback
 */
router.post('/music/play',
  validateWebhookHeaders,
  verifyWebhookSignature,
  validateWebhookPayload,
  asyncHandler(async (req, res) => {
    const { guildId, query, userId }: WebhookPayload = req.body;

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        query,
        userId,
        webhook: 'music/play'
      }, 'Processing webhook music play request');

      // Publish event to audio service
      await publishWebhookEvent('PLAY_MUSIC', guildId, {
        query,
        userId,
        source: 'webhook'
      });

      const response: APIResponse<WebhookResponse> = {
        data: {
          success: true,
          message: 'Music play request queued successfully',
          event: 'PLAY_MUSIC',
          guildId
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        query
      }, 'Webhook music play request processed successfully');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        query
      }, 'Failed to process webhook music play request');

      throw new InternalServerError('Failed to process music play webhook');
    }
  })
);

/**
 * POST /api/v1/webhooks/music/control
 * Webhook to control music playback (pause, resume, skip, stop)
 */
router.post('/music/control',
  validateWebhookHeaders,
  verifyWebhookSignature,
  validateWebhookPayload,
  asyncHandler(async (req, res) => {
    const { guildId, action, userId }: WebhookPayload = req.body;

    const validActions = ['pause', 'resume', 'skip', 'stop', 'shuffle'];
    if (!validActions.includes(action || '')) {
      throw new InternalServerError(`Invalid action: ${action}`);
    }

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        action,
        userId,
        webhook: 'music/control'
      }, 'Processing webhook music control request');

      // Publish event to audio service
      await publishWebhookEvent('CONTROL_MUSIC', guildId, {
        action,
        userId,
        source: 'webhook'
      });

      const response: APIResponse<WebhookResponse> = {
        data: {
          success: true,
          message: `Music ${action} request processed successfully`,
          event: 'CONTROL_MUSIC',
          guildId,
          action
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        action
      }, 'Webhook music control request processed successfully');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        action
      }, 'Failed to process webhook music control request');

      throw new InternalServerError('Failed to process music control webhook');
    }
  })
);

/**
 * POST /api/v1/webhooks/notifications
 * Webhook to send Discord notifications
 */
router.post('/notifications',
  validateWebhookHeaders,
  verifyWebhookSignature,
  validateWebhookPayload,
  asyncHandler(async (req, res) => {
    const { guildId, channelId, message, type }: WebhookPayload = req.body;

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        channelId,
        type,
        webhook: 'notifications'
      }, 'Processing webhook notification request');

      // Publish event to gateway service
      await publishWebhookEvent('SEND_NOTIFICATION', guildId, {
        channelId,
        message,
        type: type || 'info',
        source: 'webhook'
      });

      const response: APIResponse<WebhookResponse> = {
        data: {
          success: true,
          message: 'Notification sent successfully',
          event: 'SEND_NOTIFICATION',
          guildId
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        channelId
      }, 'Webhook notification request processed successfully');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        channelId
      }, 'Failed to process webhook notification request');

      throw new InternalServerError('Failed to process notification webhook');
    }
  })
);

/**
 * POST /api/v1/webhooks/events/subscribe
 * Subscribe to webhook events for real-time updates
 */
router.post('/events/subscribe',
  validateWebhookHeaders,
  verifyWebhookSignature,
  validateWebhookPayload,
  asyncHandler(async (req, res) => {
    const { webhookUrl, events, guildId }: WebhookPayload = req.body;

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        webhookUrl,
        events,
        guildId,
        webhook: 'events/subscribe'
      }, 'Processing webhook subscription request');

      // Store subscription in database
      await prisma.webhookSubscription.upsert({
        where: {
          guildId_webhookUrl: {
            guildId,
            webhookUrl: webhookUrl || ''
          }
        },
        update: {
          events: events || ['track_start', 'track_end', 'queue_updated'],
          isActive: true,
          updatedAt: new Date()
        },
        create: {
          guildId,
          webhookUrl: webhookUrl || '',
          events: events || ['track_start', 'track_end', 'queue_updated'],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      const response: APIResponse<WebhookResponse> = {
        data: {
          success: true,
          message: 'Webhook subscription created successfully',
          event: 'WEBHOOK_SUBSCRIBED',
          guildId,
          webhookUrl,
          events: events || ['track_start', 'track_end', 'queue_updated']
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        webhookUrl,
        eventsCount: (events || []).length
      }, 'Webhook subscription created successfully');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        webhookUrl,
        guildId
      }, 'Failed to process webhook subscription');

      throw new InternalServerError('Failed to create webhook subscription');
    }
  })
);

/**
 * GET /api/v1/webhooks/events/test
 * Test webhook endpoint for validation
 */
router.get('/events/test', asyncHandler(async (req, res) => {
  const response: APIResponse<{ status: string; timestamp: string }> = {
    data: {
      status: 'webhook_endpoint_active',
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  };

  logger.info({
    requestId: req.headers['x-request-id'],
    ip: req.ip
  }, 'Webhook test endpoint accessed');

  res.json(response);
}));

export default router;

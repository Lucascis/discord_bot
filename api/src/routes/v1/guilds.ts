import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import {
  validateGuildId,
  validatePagination,
  validateGuildSettings
} from '../../middleware/validation.js';
import { NotFoundError, InternalServerError } from '../../middleware/error-handler.js';
import type {
  APIResponse,
  PaginatedResponse,
  Guild,
  GuildSettings,
  UpdateGuildSettingsRequest
} from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import Redis from 'ioredis';
import { env } from '@discord-bot/config';

/**
 * Guild Management API Router
 *
 * Implements REST endpoints for Discord guild management
 * Following Discord.js v14 best practices and microservices architecture
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication
const redis = new Redis(env.REDIS_URL);

/**
 * Helper function to request data from Gateway service via Redis
 * Implements request-response pattern with timeout
 */
async function requestFromGateway<T>(
  requestType: string,
  payload: Record<string, unknown>,
  timeoutMs: number = process.env.NODE_ENV === 'test' ? 2000 : 5000
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  // Create response listener
  const responsePromise = new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      redis.unsubscribe(`guild-response:${requestId}`);
      reject(new Error('Gateway service timeout'));
    }, timeoutMs);

    redis.subscribe(`guild-response:${requestId}`, (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    redis.on('message', (channel, message) => {
      if (channel === `guild-response:${requestId}`) {
        clearTimeout(timeout);
        redis.unsubscribe(`guild-response:${requestId}`);

        try {
          const response = JSON.parse(message);
          if (response.error) {
            const error = new Error(response.error) as Error & { notFound?: boolean };
            // Mark as not found error if the error message indicates that
            if (response.error.toLowerCase().includes('not found')) {
              error.notFound = true;
            }
            reject(error);
          } else {
            resolve(response.data);
          }
        } catch {
          reject(new Error('Invalid response format'));
        }
      }
    });
  });

  // Send request to gateway service
  await redis.publish('discord-bot:guild-request', JSON.stringify({
    requestId,
    type: requestType,
    ...payload
  }));

  return responsePromise;
}

/**
 * GET /api/v1/guilds
 * List accessible guilds with pagination
 */
router.get('/', validatePagination, asyncHandler(async (req, res) => {
  // Parse query params explicitly to numbers (validatePagination validates but doesn't convert)
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      page,
      limit
    }, 'Fetching guild list from gateway service');

    // Request guild list from gateway service
    const guildData = await requestFromGateway<{
      guilds: Guild[];
      total: number;
    }>('GUILD_LIST', { page, limit });

    const totalPages = Math.ceil(guildData.total / limit);

    const response: PaginatedResponse<Guild> = {
      data: guildData.guilds,
      pagination: {
        page,
        limit,
        total: guildData.total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      },
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id']
    }, 'Failed to fetch guild list');

    throw new InternalServerError('Failed to fetch guild list');
  }
}));

/**
 * GET /api/v1/guilds/:guildId
 * Get specific guild information
 */
router.get('/:guildId', validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Fetching guild info from gateway service');

    // Request specific guild data from gateway service
    const guildData = await requestFromGateway<Guild>('GUILD_INFO', { guildId });

    if (!guildData) {
      throw new NotFoundError('Guild');
    }

    const response: APIResponse<Guild> = {
      data: guildData,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }

    // Check if it's a not found error from the gateway service
    if (error instanceof Error && (error as Error & { notFound?: boolean }).notFound) {
      throw new NotFoundError('Guild');
    }

    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Failed to fetch guild info');

    throw new InternalServerError('Failed to fetch guild information');
  }
}));

/**
 * GET /api/v1/guilds/:guildId/settings
 * Get guild settings from database
 */
router.get('/:guildId/settings', validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Fetching guild settings from database');

    // Fetch guild settings from database
    const settings = await prisma.serverConfiguration.findUnique({
      where: { guildId }
    });

    if (!settings) {
      // Return default settings if none exist
      const defaultSettings: GuildSettings = {
        guildId,
        defaultVolume: 50,
        autoplay: false,
        maxQueueSize: 100,
        allowExplicitContent: true,
        defaultSearchSource: 'youtube',
        announceNowPlaying: true,
        deleteInvokeMessage: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const response: APIResponse<GuildSettings> = {
        data: defaultSettings,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      res.json(response);
      return;
    }

    // Map database fields to API response
    const guildSettings: GuildSettings = {
      guildId: settings.guildId,
      defaultVolume: 50, // Field not in schema, use default
      autoplay: settings.autoplayEnabled || false,
      djRoleId: settings.djRoleId || undefined,
      maxQueueSize: settings.maxQueueSize || 100,
      allowExplicitContent: settings.allowExplicitContent ?? true,
      defaultSearchSource: 'youtube', // Field not in schema, use default
      announceNowPlaying: true, // Field not in schema, use default
      deleteInvokeMessage: false, // Field not in schema, use default
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString()
    };

    const response: APIResponse<GuildSettings> = {
      data: guildSettings,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Failed to fetch guild settings');

    throw new InternalServerError('Failed to fetch guild settings');
  }
}));

/**
 * PUT /api/v1/guilds/:guildId/settings
 * Update guild settings in database
 */
router.put('/:guildId/settings',
  validateGuildId,
  validateGuildSettings,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const updateData: UpdateGuildSettingsRequest = req.body;

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        updateFields: Object.keys(updateData)
      }, 'Updating guild settings in database');

      // Prepare update data for database
      const updatePayload: Record<string, unknown> = {
        updatedAt: new Date()
      };

      // Map API fields to database fields (only fields that exist in schema)
      if (updateData.autoplay !== undefined) {
        updatePayload.autoplayEnabled = updateData.autoplay;
      }
      if (updateData.djRoleId !== undefined) {
        updatePayload.djRoleId = updateData.djRoleId;
      }
      if (updateData.maxQueueSize !== undefined) {
        updatePayload.maxQueueSize = updateData.maxQueueSize;
      }
      if (updateData.allowExplicitContent !== undefined) {
        updatePayload.allowExplicitContent = updateData.allowExplicitContent;
      }
      // Note: defaultVolume, defaultSearchSource, announceNowPlaying, deleteInvokeMessage
      // are not in current schema, so they're ignored for now

      // Upsert guild settings
      const updatedSettings = await prisma.serverConfiguration.upsert({
        where: { guildId },
        update: updatePayload,
        create: {
          guildId,
          ...updatePayload,
          createdAt: new Date()
        }
      });

      // Map back to API response format
      const guildSettings: GuildSettings = {
        guildId: updatedSettings.guildId,
        defaultVolume: 50, // Field not in schema, use default
        autoplay: updatedSettings.autoplayEnabled || false,
        djRoleId: updatedSettings.djRoleId || undefined,
        maxQueueSize: updatedSettings.maxQueueSize || 100,
        allowExplicitContent: updatedSettings.allowExplicitContent ?? true,
        defaultSearchSource: 'youtube', // Field not in schema, use default
        announceNowPlaying: true, // Field not in schema, use default
        deleteInvokeMessage: false, // Field not in schema, use default
        createdAt: updatedSettings.createdAt.toISOString(),
        updatedAt: updatedSettings.updatedAt.toISOString()
      };

      const response: APIResponse<GuildSettings> = {
        data: guildSettings,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        fieldsUpdated: Object.keys(updateData)
      }, 'Guild settings updated successfully');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        updateData
      }, 'Failed to update guild settings');

      throw new InternalServerError('Failed to update guild settings');
    }
  })
);

export default router;

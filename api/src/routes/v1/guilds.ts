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

/**
 * Guild Management API Router
 *
 * Implements REST endpoints for Discord guild management
 * using data persisted in PostgreSQL.
 */

const router: ExpressRouter = Router();

/**
 * GET /api/v1/guilds
 * List accessible guilds with pagination
 */
router.get('/', validatePagination, asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  try {
    const totalPromise = prisma.serverConfiguration.count();
    const serversPromise = prisma.serverConfiguration.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });

    const [total, serverConfigs] = await Promise.all([totalPromise, serversPromise]);

    const guilds: Guild[] = serverConfigs.map((config) => ({
      id: config.guildId,
      name: config.guildId,
      icon: undefined,
      memberCount: undefined,
      available: true
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const response: PaginatedResponse<Guild> = {
      data: guilds,
      pagination: {
        page,
        limit,
        total,
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
    const serverConfig = await prisma.serverConfiguration.findUnique({
      where: { guildId }
    });

    if (!serverConfig) {
      throw new NotFoundError('Guild');
    }

    const guild: Guild = {
      id: serverConfig.guildId,
      name: serverConfig.guildId,
      available: true,
      icon: undefined,
      memberCount: undefined
    };

    const response: APIResponse<Guild> = {
      data: guild,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
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

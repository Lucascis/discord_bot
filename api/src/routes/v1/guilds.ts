import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import {
  validateGuildId,
  validatePagination,
  validateGuildSettings
} from '../../middleware/validation.js';
import { requireSuperAdmin } from '../../middleware/runtime-config-auth.js';
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
import { env } from '@discord-bot/config';
import Redis from 'ioredis';
import { getGuildIconURL } from '../../utils/discord.js';
import { resolveGuildTier } from '../../services/effective-guild-tier.js';

const redis = new Redis(env.REDIS_URL);
const SETTINGS_META_KEY = (guildId: string) => `discord-bot:guild-settings:${guildId}:meta`;
const DEFAULT_UI_THEME = {
  playingColor: '#6A0DAD',
  pausedColor: '#FFAA00'
};

const serializeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : error;
type ServerConfigRecord = Awaited<ReturnType<typeof prisma.serverConfiguration.findMany>>[number];
type GuildMetadataLike = {
  discordGuildId: string;
  name: string;
  icon: string | null;
  subscriptionTier?: string | null;
};
type DiscordGuildPayload = {
  id: string;
  name: string;
  icon?: string | null;
  owner_id?: string;
};
const DISCORD_GUILD_FETCH_TIMEOUT_MS = 8_000;

function normalizeHexColor(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  const formatted = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return formatted.toUpperCase();
}

function parseMeta(raw: string | null): Partial<GuildSettings> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<GuildSettings>;
  } catch (error) {
    logger.warn({ error }, 'Failed to parse guild settings meta');
    return {};
  }
}

function buildGuildPayload(config: ServerConfigRecord, metadata?: GuildMetadataLike): Guild {
  const tierResolution = resolveGuildTier({
    guildId: config.guildId,
    serverConfigTier: config.subscriptionTier,
    guildSubscriptionTier: metadata?.subscriptionTier,
  });
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  const icon = metadata?.icon?.startsWith('http')
    ? metadata.icon
    : getGuildIconURL(config.guildId, metadata?.icon ?? null, 128, 'webp');
  return {
    id: config.guildId,
    name: name || `Servidor ${config.guildId.slice(-4)}`,
    icon: icon ?? undefined,
    memberCount: undefined,
    available: true,
    subscriptionTier: tierResolution.effectiveTier,
    isPremium: tierResolution.effectiveTier === 'PREMIUM' || tierResolution.effectiveTier === 'ENTERPRISE'
  };
}

function shouldHydrateGuildMetadata(guildId: string, metadata?: GuildMetadataLike): boolean {
  if (!metadata) return true;
  const normalized = metadata.name?.trim();
  return !normalized || normalized === guildId || !metadata.icon;
}

async function fetchGuildMetadataFromDiscord(guildId: string): Promise<DiscordGuildPayload | null> {
  if (!env.DISCORD_TOKEN) return null;
  if (env.NODE_ENV === 'test') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_GUILD_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      logger.warn({ guildId, status: response.status }, 'Discord guild metadata fetch failed');
      return null;
    }

    const payload = await response.json() as DiscordGuildPayload;
    if (!payload?.name) {
      return null;
    }
    return payload;
  } catch (error) {
    logger.warn({
      guildId,
      error: serializeError(error)
    }, 'Discord guild metadata fetch errored');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function hydrateGuildMetadata(
  guildIds: string[],
  metadataMap: Map<string, GuildMetadataLike>
): Promise<void> {
  const missingGuildIds = guildIds.filter((guildId) => shouldHydrateGuildMetadata(guildId, metadataMap.get(guildId)));
  if (missingGuildIds.length === 0) return;

  await Promise.allSettled(missingGuildIds.map(async (guildId) => {
    const discordGuild = await fetchGuildMetadataFromDiscord(guildId);
    if (!discordGuild) return;

    await prisma.guild.upsert({
      where: { discordGuildId: guildId },
      update: {
        name: discordGuild.name,
        icon: discordGuild.icon ?? undefined,
        ownerId: discordGuild.owner_id ?? undefined
      },
      create: {
        discordGuildId: guildId,
        name: discordGuild.name,
        icon: discordGuild.icon ?? undefined,
        ownerId: discordGuild.owner_id ?? undefined
      }
    });

    metadataMap.set(guildId, {
      discordGuildId: guildId,
      name: discordGuild.name,
      icon: discordGuild.icon ?? null,
      subscriptionTier: metadataMap.get(guildId)?.subscriptionTier ?? null,
    });
  }));
}

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
    const guildIds = serverConfigs.map((config) => config.guildId);
    const metadataRecords = guildIds.length > 0
      ? await prisma.guild.findMany({
        where: { discordGuildId: { in: guildIds } },
        select: {
          discordGuildId: true,
          name: true,
          icon: true,
          subscription: {
            select: {
              tier: true
            }
          }
        }
      })
      : [];
    const metadataMap = new Map<string, GuildMetadataLike>(metadataRecords.map((record) => ([
      record.discordGuildId,
      {
        discordGuildId: record.discordGuildId,
        name: record.name,
        icon: record.icon,
        subscriptionTier: record.subscription?.tier ?? null,
      },
    ])));
    await hydrateGuildMetadata(guildIds, metadataMap);

    const guilds: Guild[] = serverConfigs.map((config: ServerConfigRecord) =>
      buildGuildPayload(config, metadataMap.get(config.guildId))
    );

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
      error: serializeError(error),
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
    const [serverConfig, metadataRecord] = await Promise.all([
      prisma.serverConfiguration.findUnique({
        where: { guildId }
      }),
      prisma.guild.findUnique({
        where: { discordGuildId: guildId },
        select: {
          discordGuildId: true,
          name: true,
          icon: true,
          subscription: {
            select: {
              tier: true
            }
          }
        }
      })
    ]);

    if (!serverConfig) {
      throw new NotFoundError('Guild');
    }

    let metadata: GuildMetadataLike | undefined = metadataRecord
      ? {
        discordGuildId: metadataRecord.discordGuildId,
        name: metadataRecord.name,
        icon: metadataRecord.icon,
        subscriptionTier: metadataRecord.subscription?.tier ?? null,
      }
      : undefined;
    if (shouldHydrateGuildMetadata(guildId, metadata)) {
      const discordGuild = await fetchGuildMetadataFromDiscord(guildId);
      if (discordGuild) {
        await prisma.guild.upsert({
          where: { discordGuildId: guildId },
          update: {
            name: discordGuild.name,
            icon: discordGuild.icon ?? undefined,
            ownerId: discordGuild.owner_id ?? undefined
          },
          create: {
            discordGuildId: guildId,
            name: discordGuild.name,
            icon: discordGuild.icon ?? undefined,
            ownerId: discordGuild.owner_id ?? undefined
          }
        });
        metadata = {
          discordGuildId: guildId,
          name: discordGuild.name,
          icon: discordGuild.icon ?? null,
          subscriptionTier: metadata?.subscriptionTier ?? null,
        };
      }
    }

    const guild: Guild = buildGuildPayload(serverConfig, metadata);

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
      error: serializeError(error),
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Failed to fetch guild info');

    throw new InternalServerError('Failed to fetch guild information');
  }
}));

/**
 * GET /api/v1/guilds/:guildId/channels
 * Fetch Discord guild channels (voice/text) for premium controls
 */
router.get('/:guildId/channels', validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  if (!env.DISCORD_TOKEN) {
    throw new InternalServerError('Discord token not configured');
  }

  try {
    const discordResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!discordResponse.ok) {
      logger.error({
        guildId,
        status: discordResponse.status
      }, 'Failed to fetch guild channels from Discord API');
      throw new InternalServerError('Failed to fetch Discord channels');
    }

    const rawChannels = await discordResponse.json() as Array<{ id: string; name: string; type: number }>;
    const typeMap: Record<number, 'text' | 'voice' | 'announcement' | 'stage' | null> = {
      0: 'text',
      2: 'voice',
      5: 'announcement',
      13: 'stage'
    };

    const mapped = rawChannels
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: typeMap[channel.type] ?? null
      }))
      .filter((channel) =>
        channel.type !== null &&
        !channel.name.toLowerCase().includes('voice channels') &&
        !channel.name.toLowerCase().includes('text channels')
      ) as Array<{ id: string; name: string; type: 'text' | 'voice' | 'announcement' | 'stage' }>;

    const response: APIResponse<{ id: string; name: string; type: string }[]> = {
      data: mapped,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: serializeError(error),
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Failed to fetch guild channels');

    throw new InternalServerError('Failed to fetch guild channels');
  }
}));

/**
 * GET /api/v1/guilds/:guildId/tier-debug
 * Admin diagnostic endpoint to verify DB tier vs effective tier overrides
 */
router.get('/:guildId/tier-debug', validateGuildId, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  const [serverConfig, guildRecord] = await Promise.all([
    prisma.serverConfiguration.findUnique({
      where: { guildId },
      select: { subscriptionTier: true, updatedAt: true },
    }),
    prisma.guild.findUnique({
      where: { discordGuildId: guildId },
      select: {
        id: true,
        isTestGuild: true,
        subscription: {
          select: {
            tier: true,
            status: true,
            updatedAt: true,
          }
        }
      },
    }),
  ]);

  const tierResolution = resolveGuildTier({
    guildId,
    serverConfigTier: serverConfig?.subscriptionTier,
    guildSubscriptionTier: guildRecord?.subscription?.tier ?? null,
  });

  res.json({
    data: {
      guildId,
      dbTier: tierResolution.dbTier,
      effectiveTier: tierResolution.effectiveTier,
      source: tierResolution.source,
      overrideActive: tierResolution.overrideActive,
      details: {
        guildSubscriptionTier: guildRecord?.subscription?.tier ?? null,
        guildSubscriptionStatus: guildRecord?.subscription?.status ?? null,
        serverConfigurationTier: serverConfig?.subscriptionTier ?? null,
        guildMarkedAsTest: guildRecord?.isTestGuild ?? false,
        premiumTestGuildsConfigured: env.PREMIUM_TEST_GUILD_IDS_LIST,
        guildSubscriptionUpdatedAt: guildRecord?.subscription?.updatedAt?.toISOString() ?? null,
        serverConfigurationUpdatedAt: serverConfig?.updatedAt?.toISOString() ?? null,
      }
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] as string
  });
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
        uiTheme: { ...DEFAULT_UI_THEME },
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

    const metaRaw = await redis.get(SETTINGS_META_KEY(guildId));
    const meta = parseMeta(metaRaw);

    // Map database fields to API response
    const playingColor = normalizeHexColor(meta.uiTheme?.playingColor) ?? DEFAULT_UI_THEME.playingColor;
    const pausedColor = normalizeHexColor(meta.uiTheme?.pausedColor) ?? DEFAULT_UI_THEME.pausedColor;
    const guildSettings: GuildSettings = {
      guildId: settings.guildId,
      defaultVolume: settings.volumeLimit ?? 50,
      autoplay: settings.autoplayEnabled || false,
      djRoleId: settings.djRoleId || undefined,
      maxQueueSize: settings.maxQueueSize || 100,
      allowExplicitContent: settings.allowExplicitContent ?? true,
      defaultSearchSource: (meta.defaultSearchSource as GuildSettings['defaultSearchSource']) ?? 'youtube',
      announceNowPlaying: meta.announceNowPlaying ?? true,
      deleteInvokeMessage: meta.deleteInvokeMessage ?? settings.ephemeralMessages ?? false,
      uiTheme: {
        playingColor,
        pausedColor
      },
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
      error: serializeError(error),
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
    const metaKey = SETTINGS_META_KEY(guildId);
    const meta = parseMeta(await redis.get(metaKey));

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
      let normalizedDefaultVolume: number | undefined;

      // Map API fields to database fields (only fields that exist in schema)
      if (updateData.defaultVolume !== undefined) {
        // Store defaultVolume in volumeLimit slot, clamped 0-100 to match UI expectation
        normalizedDefaultVolume = Math.min(100, Math.max(0, updateData.defaultVolume));
        updatePayload.volumeLimit = normalizedDefaultVolume;
      }
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
      // Persist meta settings in Redis (fields not in DB schema)
      const metaPayload: Partial<GuildSettings> = { ...meta };
      if (updateData.defaultSearchSource !== undefined) {
        metaPayload.defaultSearchSource = updateData.defaultSearchSource;
      }
      if (updateData.announceNowPlaying !== undefined) {
        metaPayload.announceNowPlaying = updateData.announceNowPlaying;
      }
      if (updateData.deleteInvokeMessage !== undefined) {
        metaPayload.deleteInvokeMessage = updateData.deleteInvokeMessage;
        updatePayload.ephemeralMessages = updateData.deleteInvokeMessage;
      }
      if (updateData.uiTheme) {
        const playingColor = normalizeHexColor(updateData.uiTheme.playingColor) ??
          normalizeHexColor(meta.uiTheme?.playingColor) ??
          DEFAULT_UI_THEME.playingColor;
        const pausedColor = normalizeHexColor(updateData.uiTheme.pausedColor) ??
          normalizeHexColor(meta.uiTheme?.pausedColor) ??
          DEFAULT_UI_THEME.pausedColor;
        metaPayload.uiTheme = {
          playingColor,
          pausedColor
        };
      } else if (meta.uiTheme) {
        metaPayload.uiTheme = {
          playingColor: normalizeHexColor(meta.uiTheme.playingColor) ?? DEFAULT_UI_THEME.playingColor,
          pausedColor: normalizeHexColor(meta.uiTheme.pausedColor) ?? DEFAULT_UI_THEME.pausedColor
        };
      }

      await redis.set(metaKey, JSON.stringify(metaPayload));

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
      const responseMeta = parseMeta(await redis.get(metaKey));
      const playingColor = normalizeHexColor(responseMeta.uiTheme?.playingColor) ?? DEFAULT_UI_THEME.playingColor;
      const pausedColor = normalizeHexColor(responseMeta.uiTheme?.pausedColor) ?? DEFAULT_UI_THEME.pausedColor;
      const guildSettings: GuildSettings = {
        guildId: updatedSettings.guildId,
        defaultVolume: normalizedDefaultVolume ?? updatedSettings.volumeLimit ?? 50,
        autoplay: updateData.autoplay ?? updatedSettings.autoplayEnabled ?? false,
        djRoleId: updatedSettings.djRoleId || undefined,
        maxQueueSize: updateData.maxQueueSize ?? updatedSettings.maxQueueSize ?? 100,
        allowExplicitContent: updateData.allowExplicitContent ?? updatedSettings.allowExplicitContent ?? true,
        defaultSearchSource: (responseMeta.defaultSearchSource as GuildSettings['defaultSearchSource']) ?? 'youtube',
        announceNowPlaying: responseMeta.announceNowPlaying ?? true,
        deleteInvokeMessage: responseMeta.deleteInvokeMessage ?? updatedSettings.ephemeralMessages ?? false,
        uiTheme: {
          playingColor,
          pausedColor
        },
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
        error: serializeError(error),
        requestId: req.headers['x-request-id'],
        guildId,
        updateData
      }, 'Failed to update guild settings');

      throw new InternalServerError('Failed to update guild settings');
    }
  })
);

export default router;

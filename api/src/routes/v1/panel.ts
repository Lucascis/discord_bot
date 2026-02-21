import { Router, type Router as ExpressRouter } from 'express';
import Redis from 'ioredis';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId, validateGuildSettings } from '../../middleware/validation.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import { ValidationError, NotFoundError, InternalServerError } from '../../middleware/error-handler.js';
import type { APIResponse, Guild, GuildSettings, UpdateGuildSettingsRequest } from '../../types/api.js';
import { getGuildIconURL } from '../../utils/discord.js';
import { getRuntimeAuthContext, requireGuildAdminOrSuperAdmin } from '../../middleware/runtime-config-auth.js';
import { hasManageGuildPermission } from '../../services/discord-guild-permissions.js';

const router: ExpressRouter = Router();
const redis = new Redis(env.REDIS_URL);

const SETTINGS_META_KEY = (guildId: string) => `discord-bot:guild-settings:${guildId}:meta`;
const ACTIVE_INSTANCE_KEY = (guildId: string) => `discord-bot:active-instances:${guildId}`;
const DEFAULT_UI_THEME = {
  playingColor: '#6A0DAD',
  pausedColor: '#FFAA00'
};

const PERSONAL_MODE_INSTANCE_LIMIT = 10;

function getRequestId(headerValue: string | string[] | undefined): string | undefined {
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

const summonSchema = z.object({
  voiceChannelId: z.string().regex(/^\d{17,19}$/, 'Invalid voice channel ID'),
  textChannelId: z.string().regex(/^\d{17,19}$/, 'Invalid text channel ID')
});

type GuildMetadataLike = {
  discordGuildId: string;
  name: string;
  icon: string | null;
  ownerId?: string | null;
};

type DiscordGuildSummary = {
  id: string;
  name?: string;
  icon?: string | null;
};

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
  } catch {
    return {};
  }
}

async function fetchDiscordGuildSummary(guildId: string): Promise<DiscordGuildSummary | null> {
  if (!env.DISCORD_TOKEN) return null;

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) return null;
    return await response.json() as DiscordGuildSummary;
  } catch (error) {
    logger.debug({ guildId, error }, 'panel.guilds: failed to fetch guild summary from Discord API');
    return null;
  }
}

async function readActiveInstances(guildId: string): Promise<Record<string, string>> {
  const key = ACTIVE_INSTANCE_KEY(guildId);
  const keyType = await redis.type(key);

  if (keyType === 'none') {
    return {};
  }

  if (keyType === 'hash') {
    return await redis.hgetall(key);
  }

  await redis.del(key);
  return {};
}

async function writeActiveInstanceMapping(guildId: string, voiceChannelId: string, textChannelId: string): Promise<void> {
  const key = ACTIVE_INSTANCE_KEY(guildId);
  await redis.hset(key, voiceChannelId, textChannelId);
  await redis.expire(key, 3600);
}

async function resetActiveInstances(guildId: string): Promise<void> {
  await redis.del(ACTIVE_INSTANCE_KEY(guildId));
}

function buildGuildPayload(
  config: {
    guildId: string;
  },
  metadata?: GuildMetadataLike,
): Guild {
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  const icon = metadata?.icon?.startsWith('http')
    ? metadata.icon
    : getGuildIconURL(config.guildId, metadata?.icon ?? null, 128, 'webp');
  return {
    id: config.guildId,
    name: name || `Servidor ${config.guildId.slice(-4)}`,
    icon: icon ?? undefined,
    memberCount: undefined,
    available: true
  };
}

router.get('/guilds', asyncHandler(async (req, res) => {
  const auth = await getRuntimeAuthContext(req);

  const [serverConfigs, metadataRecords] = await Promise.all([
    prisma.serverConfiguration.findMany({
      orderBy: { createdAt: 'desc' }
    }),
    prisma.guild.findMany({
      select: {
        discordGuildId: true,
        name: true,
        icon: true,
        ownerId: true
      }
    })
  ]);

  const metadataByGuildId = new Map<string, GuildMetadataLike>(
    metadataRecords.map((record) => [
      record.discordGuildId,
      {
        discordGuildId: record.discordGuildId,
        name: record.name,
        icon: record.icon,
        ownerId: record.ownerId
      }
    ])
  );

  const configByGuildId = new Map<string, { guildId: string }>(
    serverConfigs.map((config) => [config.guildId, config])
  );

  const candidateGuildIds = new Set<string>([
    ...serverConfigs.map((config) => config.guildId),
    ...metadataRecords.map((record) => record.discordGuildId),
  ]);

  const visibleGuilds: Guild[] = [];
  for (const guildId of candidateGuildIds) {
    const config = configByGuildId.get(guildId) ?? { guildId };
    if (auth.isSuperAdmin) {
      visibleGuilds.push(buildGuildPayload(config, metadataByGuildId.get(config.guildId)));
      continue;
    }

    const metadata = metadataByGuildId.get(config.guildId);
    const isOwner = Boolean(metadata?.ownerId && metadata.ownerId === auth.discordUserId);
    if (isOwner) {
      visibleGuilds.push(buildGuildPayload(config, metadata));
      continue;
    }

    const canManage = await hasManageGuildPermission(config.guildId, auth.discordUserId);
    if (canManage) {
      visibleGuilds.push(buildGuildPayload(config, metadata));
    }
  }

  for (let index = 0; index < visibleGuilds.length; index += 1) {
    const guild = visibleGuilds[index];
    const metadata = metadataByGuildId.get(guild.id);
    if (!guild.name || guild.name.startsWith('Servidor ')) {
      const summary = await fetchDiscordGuildSummary(guild.id);
      if (summary?.name) {
        guild.name = summary.name;
      }
      if (!guild.icon && summary?.icon) {
        guild.icon = getGuildIconURL(guild.id, summary.icon, 128, 'webp') ?? undefined;
      }
      if (summary?.name || summary?.icon) {
        metadataByGuildId.set(guild.id, {
          discordGuildId: guild.id,
          name: summary?.name ?? metadata?.name ?? guild.name,
          icon: summary?.icon ?? metadata?.icon ?? null,
          ownerId: metadata?.ownerId ?? null
        });
      }
    }
  }

  res.json({
    data: visibleGuilds,
    pagination: {
      page: 1,
      limit: visibleGuilds.length,
      total: visibleGuilds.length,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id']
      ? getRequestId(req.headers['x-request-id'])
      : undefined
  });
}));

router.get('/guilds/:guildId/settings', validateGuildId, requireGuildAdminOrSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  const settings = await prisma.serverConfiguration.findUnique({
    where: { guildId }
  });

  if (!settings) {
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

    res.json({
      data: defaultSettings,
      timestamp: new Date().toISOString(),
      requestId: getRequestId(req.headers['x-request-id'])
    } satisfies APIResponse<GuildSettings>);
    return;
  }

  const meta = parseMeta(await redis.get(SETTINGS_META_KEY(guildId)));
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

  res.json({
    data: guildSettings,
    timestamp: new Date().toISOString(),
    requestId: getRequestId(req.headers['x-request-id'])
  } satisfies APIResponse<GuildSettings>);
}));

router.put('/guilds/:guildId/settings', validateGuildId, requireGuildAdminOrSuperAdmin, validateGuildSettings, asyncHandler(async (req, res) => {
  const { guildId } = req.params;
  const updateData: UpdateGuildSettingsRequest = req.body;
  const metaKey = SETTINGS_META_KEY(guildId);
  const meta = parseMeta(await redis.get(metaKey));

  const updatePayload: Record<string, unknown> = {
    updatedAt: new Date()
  };
  let normalizedDefaultVolume: number | undefined;

  if (updateData.defaultVolume !== undefined) {
    normalizedDefaultVolume = Math.min(100, Math.max(0, updateData.defaultVolume));
    updatePayload.volumeLimit = normalizedDefaultVolume;
  }
  if (updateData.autoplay !== undefined) updatePayload.autoplayEnabled = updateData.autoplay;
  if (updateData.djRoleId !== undefined) updatePayload.djRoleId = updateData.djRoleId;
  if (updateData.maxQueueSize !== undefined) updatePayload.maxQueueSize = updateData.maxQueueSize;
  if (updateData.allowExplicitContent !== undefined) updatePayload.allowExplicitContent = updateData.allowExplicitContent;

  const metaPayload: Partial<GuildSettings> = { ...meta };
  if (updateData.defaultSearchSource !== undefined) metaPayload.defaultSearchSource = updateData.defaultSearchSource;
  if (updateData.announceNowPlaying !== undefined) metaPayload.announceNowPlaying = updateData.announceNowPlaying;
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

  const updatedSettings = await prisma.serverConfiguration.upsert({
    where: { guildId },
    update: updatePayload,
    create: {
      guildId,
      ...updatePayload,
      createdAt: new Date()
    }
  });

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

  res.json({
    data: guildSettings,
    timestamp: new Date().toISOString(),
    requestId: getRequestId(req.headers['x-request-id'])
  } satisfies APIResponse<GuildSettings>);
}));

router.get('/guilds/:guildId/channels', validateGuildId, requireGuildAdminOrSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  if (!env.DISCORD_TOKEN) {
    throw new InternalServerError('Discord token not configured');
  }

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

  res.json({
    data: mapped,
    timestamp: new Date().toISOString(),
    requestId: getRequestId(req.headers['x-request-id'])
  } satisfies APIResponse<{ id: string; name: string; type: string }[]>);
}));

router.post('/guilds/:guildId/summon', validateGuildId, requireGuildAdminOrSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId } = req.params;
  const payload = summonSchema.parse(req.body ?? {});

  const serverConfig = await prisma.serverConfiguration.findUnique({
    where: { guildId }
  });

  if (!serverConfig) {
    throw new NotFoundError('Guild');
  }

  const limit = PERSONAL_MODE_INSTANCE_LIMIT;
  const activeInstances = await readActiveInstances(guildId);
  const activeEntries = Object.entries(activeInstances);
  const isDuplicateInstance = activeEntries.some(([voice, text]) => voice === payload.voiceChannelId && text === payload.textChannelId);

  if (!isDuplicateInstance && activeEntries.length >= limit) {
    if (limit === 1) {
      await resetActiveInstances(guildId);
    } else {
      throw new ValidationError(`Alcanzaste el máximo de instancias activas (${limit}) en modo personal.`);
    }
  }

  await writeActiveInstanceMapping(guildId, payload.voiceChannelId, payload.textChannelId);
  await redis.publish('discord-bot:panel-commands', JSON.stringify({
    type: 'summon',
    guildId,
    voiceChannelId: payload.voiceChannelId,
    textChannelId: payload.textChannelId,
    requestId: `summon_${Date.now()}`
  }));

  res.json({
    data: { accepted: true },
    timestamp: new Date().toISOString(),
    requestId: getRequestId(req.headers['x-request-id'])
  });
}));

export default router;

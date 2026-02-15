import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

const ADMINISTRATOR_BIT = 1n << 3n;
const MANAGE_GUILD_BIT = 1n << 5n;
const PERMISSION_CACHE_TTL_MS = 60_000;

type PermissionCacheEntry = {
  allowed: boolean;
  expiresAt: number;
};

const permissionCache = new Map<string, PermissionCacheEntry>();

type DiscordRolePayload = {
  id: string;
  permissions: string;
};

type DiscordMemberPayload = {
  roles: string[];
};

type DiscordGuildPayload = {
  id: string;
  owner_id?: string;
};

function cacheKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function discordGet<T>(path: string): Promise<T | null> {
  if (!env.DISCORD_TOKEN) return null;
  try {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch (error) {
    logger.warn({ error, path }, 'discord permission lookup failed');
    return null;
  }
}

function hasRequiredGuildPermission(member: DiscordMemberPayload, roles: DiscordRolePayload[], guildId: string): boolean {
  const roleIds = new Set<string>([guildId, ...(member.roles ?? [])]);
  let permissions = 0n;

  for (const role of roles) {
    if (!roleIds.has(role.id)) continue;
    try {
      permissions |= BigInt(role.permissions ?? '0');
    } catch {
      // Skip malformed permissions payload.
    }
  }

  return (permissions & ADMINISTRATOR_BIT) !== 0n || (permissions & MANAGE_GUILD_BIT) !== 0n;
}

export async function hasManageGuildPermission(guildId: string, discordUserId: string): Promise<boolean> {
  if (!guildId || !discordUserId || !env.DISCORD_TOKEN) {
    return false;
  }

  const key = cacheKey(guildId, discordUserId);
  const cached = permissionCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.allowed;
  }

  const [guild, member, roles] = await Promise.all([
    discordGet<DiscordGuildPayload>(`/guilds/${guildId}`),
    discordGet<DiscordMemberPayload>(`/guilds/${guildId}/members/${discordUserId}`),
    discordGet<DiscordRolePayload[]>(`/guilds/${guildId}/roles`)
  ]);

  const allowed =
    (guild?.owner_id !== undefined && guild.owner_id === discordUserId) ||
    (!!member && Array.isArray(roles) && hasRequiredGuildPermission(member, roles, guildId));

  permissionCache.set(key, {
    allowed,
    expiresAt: now + PERMISSION_CACHE_TTL_MS,
  });

  return allowed;
}

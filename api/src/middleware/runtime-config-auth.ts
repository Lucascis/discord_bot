import type { Request, Response, NextFunction } from 'express';
import { AdminRole, prisma } from '@discord-bot/database';
import { env } from '@discord-bot/config';
import { ForbiddenError, UnauthorizedError } from './error-handler.js';
import { hasManageGuildPermission } from '../services/discord-guild-permissions.js';

export type RuntimeAuthContext = {
  discordUserId: string;
  isSuperAdmin: boolean;
  isReadOnlyAdmin: boolean;
};

const runtimeAuthCache = new WeakMap<Request, RuntimeAuthContext>();

function extractDiscordUserId(req: Request): string {
  const raw = req.headers['x-discord-user-id'] ?? req.headers['x-user-id'];
  if (!raw || Array.isArray(raw)) {
    throw new UnauthorizedError('Missing x-discord-user-id header');
  }
  const value = String(raw).trim();
  if (!/^\d{17,19}$/.test(value)) {
    throw new UnauthorizedError('Invalid x-discord-user-id header');
  }
  return value;
}

async function resolveStaffFallback(discordUserId: string): Promise<boolean> {
  const count = await prisma.adminUser.count({ where: { active: true } });
  if (count > 0) return false;

  const fallbackIds = (env.PANEL_STAFF_DISCORD_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return fallbackIds.includes(discordUserId);
}

async function resolveRuntimeAuthContext(req: Request): Promise<RuntimeAuthContext> {
  const cached = runtimeAuthCache.get(req);
  if (cached) return cached;

  const discordUserId = extractDiscordUserId(req);
  const admin = await prisma.adminUser.findUnique({
    where: { discordUserId },
    select: { role: true, active: true },
  });

  const isFallbackStaff = await resolveStaffFallback(discordUserId);
  const isSuperAdmin = Boolean((admin?.active && admin.role === AdminRole.SUPERADMIN) || isFallbackStaff);
  const isReadOnlyAdmin = Boolean(admin?.active && admin.role === AdminRole.READ_ONLY);
  const ctx = { discordUserId, isSuperAdmin, isReadOnlyAdmin };
  runtimeAuthCache.set(req, ctx);
  return ctx;
}

export async function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveRuntimeAuthContext(req);
  if (!auth.isSuperAdmin) {
    throw new ForbiddenError('Superadmin role required');
  }
  next();
}

export async function requireGuildAdminOrSuperAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = await resolveRuntimeAuthContext(req);
  if (auth.isSuperAdmin) {
    next();
    return;
  }

  const guildId = req.params.guildId;
  if (!guildId) {
    throw new ForbiddenError('Guild context is required');
  }

  const guild = await prisma.guild.findUnique({
    where: { discordGuildId: guildId },
    select: { ownerId: true },
  });

  const isOwner = Boolean(guild?.ownerId && guild.ownerId === auth.discordUserId);
  const canManageGuild = await hasManageGuildPermission(guildId, auth.discordUserId);

  if (!isOwner && !canManageGuild) {
    throw new ForbiddenError('Guild admin role required for this guild');
  }

  next();
}

export async function getRuntimeAuthContext(req: Request): Promise<RuntimeAuthContext> {
  return await resolveRuntimeAuthContext(req);
}

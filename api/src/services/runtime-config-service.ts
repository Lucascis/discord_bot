import * as crypto from 'node:crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { env } from '@discord-bot/config';
import {
  prisma,
  RuntimeConfigScope,
  RuntimeConfigValueType,
  RuntimePlanTier,
  RuntimeConfigSensitivity,
  ConfigActorRole,
} from '@discord-bot/database';
import type { Prisma } from '@discord-bot/database';
import { ValidationError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';

type ConfigSource = 'guild' | 'global' | 'env';

const planRank: Record<RuntimePlanTier, number> = {
  FREE: 0,
  BASIC: 1,
  PREMIUM: 2,
  ENTERPRISE: 3,
};

const redis = new Redis(env.REDIS_URL);

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function hashValue(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function parseJsonValue(raw: unknown, valueType: RuntimeConfigValueType): unknown {
  switch (valueType) {
    case RuntimeConfigValueType.STRING:
      return z.string().parse(raw);
    case RuntimeConfigValueType.NUMBER:
      return z.number().parse(raw);
    case RuntimeConfigValueType.BOOLEAN:
      return z.boolean().parse(raw);
    case RuntimeConfigValueType.JSON:
      return raw;
    default:
      return raw;
  }
}

function validateRuntimeValue(raw: unknown, definition: {
  key: string;
  valueType: RuntimeConfigValueType;
  validationSchema: unknown;
}): unknown {
  try {
    const typedValue = parseJsonValue(raw, definition.valueType);
    const schema = parseValidationSchema(definition.validationSchema);
    if (schema) schema.parse(typedValue);
    return typedValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid runtime config value';
    throw new ValidationError(`Invalid value for ${definition.key}: ${message}`);
  }
}

function parseValidationSchema(definitionSchema: unknown): z.ZodTypeAny | null {
  if (!definitionSchema || typeof definitionSchema !== 'object' || Array.isArray(definitionSchema)) {
    return null;
  }

  const schema = definitionSchema as Record<string, unknown>;
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (!type) return null;

  if (type === 'string') {
    let validator = z.string();
    if (typeof schema.minLength === 'number') validator = validator.min(schema.minLength);
    if (typeof schema.maxLength === 'number') validator = validator.max(schema.maxLength);
    return validator;
  }

  if (type === 'number') {
    let validator = z.number();
    if (typeof schema.min === 'number') validator = validator.min(schema.min);
    if (typeof schema.max === 'number') validator = validator.max(schema.max);
    return validator;
  }

  if (type === 'boolean') return z.boolean();

  return null;
}

function maskIfSensitive(value: unknown, sensitivity: RuntimeConfigSensitivity): unknown {
  if (value === undefined || value === null) return value;
  if (sensitivity === RuntimeConfigSensitivity.PUBLIC) return value;
  return '***';
}

async function resolveGuildTier(guildId: string): Promise<RuntimePlanTier> {
  const config = await prisma.serverConfiguration.findUnique({
    where: { guildId },
    select: { subscriptionTier: true },
  });
  const tier = (config?.subscriptionTier ?? 'free').toUpperCase();
  if (tier === 'ENTERPRISE') return RuntimePlanTier.ENTERPRISE;
  if (tier === 'PREMIUM') return RuntimePlanTier.PREMIUM;
  if (tier === 'BASIC') return RuntimePlanTier.BASIC;
  return RuntimePlanTier.FREE;
}

async function invalidateConfig(key: string, guildId?: string): Promise<void> {
  await redis.publish(`config:invalidate:${key}`, JSON.stringify({ key, guildId, ts: Date.now() }));
  if (guildId) {
    await redis.publish(`config:invalidate:guild:${guildId}`, JSON.stringify({ key, guildId, ts: Date.now() }));
  }
}

export interface EffectiveConfigResponse {
  key: string;
  effectiveValue: unknown;
  source: ConfigSource;
  hotReloadApplied: boolean;
  requiresRestart: boolean;
  blockedByPlan: boolean;
}

type RuntimeConfigDefinitionRecord = Prisma.RuntimeConfigDefinitionGetPayload<Record<string, never>>;
type ConfigAuditLogRecord = Prisma.ConfigAuditLogGetPayload<Record<string, never>>;

interface RuntimeGlobalValueResponse {
  key: string;
  scope: RuntimeConfigScope;
  valueType: RuntimeConfigValueType;
  mutable: boolean;
  hotReload: boolean;
  value: unknown;
  version: number;
}

export class RuntimeConfigService {
  async getDefinitions(): Promise<RuntimeConfigDefinitionRecord[]> {
    return await prisma.runtimeConfigDefinition.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async getGlobalValues(): Promise<RuntimeGlobalValueResponse[]> {
    const [definitions, values] = await Promise.all([
      prisma.runtimeConfigDefinition.findMany({ orderBy: { key: 'asc' } }),
      prisma.runtimeConfigValue.findMany(),
    ]);

    const valueMap = new Map(values.map((item) => [item.definitionKey, item]));

    return definitions.map((definition) => {
      const current = valueMap.get(definition.key);
      return {
        key: definition.key,
        scope: definition.scope,
        valueType: definition.valueType,
        mutable: definition.mutable,
        hotReload: definition.hotReload,
        value: maskIfSensitive(current?.value, definition.sensitivity),
        version: current?.version ?? 0,
      };
    });
  }

  async getGuildValues(guildId: string) {
    const overrides = await prisma.guildRuntimeConfigOverride.findMany({
      where: { guildId },
      include: { definition: true },
      orderBy: { definitionKey: 'asc' },
    });

    return overrides.map((override) => ({
      guildId,
      key: override.definitionKey,
      value: maskIfSensitive(override.value, override.definition.sensitivity),
      updatedAt: override.updatedAt,
    }));
  }

  async getEffectiveConfigForGuild(guildId: string): Promise<EffectiveConfigResponse[]> {
    const definitions = await prisma.runtimeConfigDefinition.findMany({ orderBy: { key: 'asc' } });
    const results: EffectiveConfigResponse[] = [];
    for (const definition of definitions) {
      const effective = await this.getEffectiveConfig(definition.key, guildId);
      results.push(effective);
    }
    return results;
  }

  async getEffectiveConfig(key: string, guildId?: string): Promise<EffectiveConfigResponse> {
    const definition = await prisma.runtimeConfigDefinition.findUnique({ where: { key } });
    if (!definition) throw new NotFoundError(`Runtime config definition ${key}`);

    let blockedByPlan = false;
    if (guildId && definition.scope !== RuntimeConfigScope.GLOBAL) {
      const guildTier = await resolveGuildTier(guildId);
      blockedByPlan = planRank[guildTier] < planRank[definition.planMinTier];
      if (blockedByPlan) {
        return {
          key,
          effectiveValue: null,
          source: 'global',
          hotReloadApplied: definition.hotReload,
          requiresRestart: !definition.hotReload,
          blockedByPlan: true,
        };
      }
    }

    if (guildId) {
      const override = await prisma.guildRuntimeConfigOverride.findUnique({
        where: {
          guildId_definitionKey: {
            guildId,
            definitionKey: key,
          },
        },
      });
      if (override) {
        return {
          key,
          effectiveValue: maskIfSensitive(override.value, definition.sensitivity),
          source: 'guild',
          hotReloadApplied: definition.hotReload,
          requiresRestart: !definition.hotReload,
          blockedByPlan,
        };
      }
    }

    const global = await prisma.runtimeConfigValue.findUnique({ where: { definitionKey: key } });
    if (global) {
      return {
        key,
        effectiveValue: maskIfSensitive(global.value, definition.sensitivity),
        source: 'global',
        hotReloadApplied: definition.hotReload,
        requiresRestart: !definition.hotReload,
        blockedByPlan,
      };
    }

    const envFallback = process.env[key];
    return {
      key,
      effectiveValue: maskIfSensitive(envFallback ?? null, definition.sensitivity),
      source: 'env',
      hotReloadApplied: false,
      requiresRestart: !definition.hotReload,
      blockedByPlan,
    };
  }

  async updateGlobalValue(params: {
    actorDiscordUserId: string;
    actorRole: ConfigActorRole;
    key: string;
    value: unknown;
    reason?: string;
  }) {
    const definition = await prisma.runtimeConfigDefinition.findUnique({ where: { key: params.key } });
    if (!definition) throw new NotFoundError(`Runtime config definition ${params.key}`);
    if (!definition.mutable) throw new ForbiddenError(`Config key ${params.key} is immutable`);
    if (definition.scope === RuntimeConfigScope.GUILD) {
      throw new ForbiddenError(`Config key ${params.key} can only be overridden per guild`);
    }

    const typedValue = validateRuntimeValue(params.value, definition);

    const current = await prisma.runtimeConfigValue.findUnique({ where: { definitionKey: params.key } });
    const version = (current?.version ?? 0) + 1;
    const valueForStorage = typedValue as Prisma.InputJsonValue;
    const next = await prisma.runtimeConfigValue.upsert({
      where: { definitionKey: params.key },
      create: {
        definitionKey: params.key,
        value: valueForStorage,
        version,
        updatedBy: params.actorDiscordUserId,
      },
      update: {
        value: valueForStorage,
        version,
        updatedBy: params.actorDiscordUserId,
      },
    });

    await prisma.configAuditLog.create({
      data: {
        actorDiscordUserId: params.actorDiscordUserId,
        actorRole: params.actorRole,
        scope: RuntimeConfigScope.GLOBAL,
        key: params.key,
        oldValueHash: hashValue(current?.value),
        newValueHash: hashValue(typedValue),
        reason: params.reason,
      },
    });

    await invalidateConfig(params.key);

    return {
      key: next.definitionKey,
      value: maskIfSensitive(next.value, definition.sensitivity),
      hotReloadApplied: definition.hotReload,
      requiresRestart: !definition.hotReload,
      version: next.version,
      source: 'global' as const,
    };
  }

  async updateGuildValue(params: {
    actorDiscordUserId: string;
    actorRole: ConfigActorRole;
    guildId: string;
    key: string;
    value: unknown;
    reason?: string;
  }) {
    const definition = await prisma.runtimeConfigDefinition.findUnique({ where: { key: params.key } });
    if (!definition) throw new NotFoundError(`Runtime config definition ${params.key}`);
    if (!definition.mutable) throw new ForbiddenError(`Config key ${params.key} is immutable`);
    if (definition.scope === RuntimeConfigScope.GLOBAL) {
      throw new ForbiddenError(`Config key ${params.key} is global only`);
    }

    const guildTier = await resolveGuildTier(params.guildId);
    const blockedByPlan = planRank[guildTier] < planRank[definition.planMinTier];
    if (blockedByPlan) {
      throw new ForbiddenError(`Plan ${guildTier} cannot override key ${params.key} (requires ${definition.planMinTier})`);
    }

    const typedValue = validateRuntimeValue(params.value, definition);

    const current = await prisma.guildRuntimeConfigOverride.findUnique({
      where: {
        guildId_definitionKey: {
          guildId: params.guildId,
          definitionKey: params.key,
        },
      },
    });

    const valueForStorage = typedValue as Prisma.InputJsonValue;
    const next = await prisma.guildRuntimeConfigOverride.upsert({
      where: {
        guildId_definitionKey: {
          guildId: params.guildId,
          definitionKey: params.key,
        },
      },
      create: {
        guildId: params.guildId,
        definitionKey: params.key,
        value: valueForStorage,
        updatedBy: params.actorDiscordUserId,
      },
      update: {
        value: valueForStorage,
        updatedBy: params.actorDiscordUserId,
      },
    });

    await prisma.configAuditLog.create({
      data: {
        actorDiscordUserId: params.actorDiscordUserId,
        actorRole: params.actorRole,
        scope: RuntimeConfigScope.GUILD,
        guildId: params.guildId,
        key: params.key,
        oldValueHash: hashValue(current?.value),
        newValueHash: hashValue(typedValue),
        reason: params.reason,
      },
    });

    await invalidateConfig(params.key, params.guildId);

    return {
      key: next.definitionKey,
      guildId: next.guildId,
      value: maskIfSensitive(next.value, definition.sensitivity),
      hotReloadApplied: definition.hotReload,
      requiresRestart: !definition.hotReload,
      source: 'guild' as const,
    };
  }

  async listAudit(options: { limit?: number; guildId?: string }): Promise<ConfigAuditLogRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    return await prisma.configAuditLog.findMany({
      where: options.guildId ? { guildId: options.guildId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const runtimeConfigService = new RuntimeConfigService();

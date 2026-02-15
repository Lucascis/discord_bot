import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId } from '../../middleware/validation.js';
import { requireSuperAdmin, getRuntimeAuthContext } from '../../middleware/runtime-config-auth.js';
import { runtimeConfigService } from '../../services/runtime-config-service.js';
import { ConfigActorRole } from '@discord-bot/database';

const router: ExpressRouter = Router();

const updateBodySchema = z.object({
  value: z.unknown(),
  reason: z.string().max(500).optional(),
});

router.get('/definitions', requireSuperAdmin, asyncHandler(async (req, res) => {
  const definitions = await runtimeConfigService.getDefinitions();
  res.json({
    data: definitions,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.get('/global', requireSuperAdmin, asyncHandler(async (req, res) => {
  const values = await runtimeConfigService.getGlobalValues();
  res.json({
    data: values,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.put('/global/:key', requireSuperAdmin, asyncHandler(async (req, res) => {
  const { key } = req.params;
  const body = updateBodySchema.parse(req.body ?? {});
  const auth = await getRuntimeAuthContext(req);

  const result = await runtimeConfigService.updateGlobalValue({
    actorDiscordUserId: auth.discordUserId,
    actorRole: ConfigActorRole.SUPERADMIN,
    key,
    value: body.value,
    reason: body.reason,
  });

  res.json({
    data: {
      effectiveValue: result.value,
      source: result.source,
      hotReloadApplied: result.hotReloadApplied,
      requiresRestart: result.requiresRestart,
      blockedByPlan: false,
      version: result.version,
      key: result.key,
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.get('/guilds/:guildId', requireSuperAdmin, validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;
  const values = await runtimeConfigService.getGuildValues(guildId);
  res.json({
    data: values,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.put('/guilds/:guildId/:key', requireSuperAdmin, validateGuildId, asyncHandler(async (req, res) => {
  const { guildId, key } = req.params;
  const body = updateBodySchema.parse(req.body ?? {});
  const auth = await getRuntimeAuthContext(req);

  const result = await runtimeConfigService.updateGuildValue({
    actorDiscordUserId: auth.discordUserId,
    actorRole: ConfigActorRole.SUPERADMIN,
    guildId,
    key,
    value: body.value,
    reason: body.reason,
  });

  res.json({
    data: {
      effectiveValue: result.value,
      source: result.source,
      hotReloadApplied: result.hotReloadApplied,
      requiresRestart: result.requiresRestart,
      blockedByPlan: false,
      guildId: result.guildId,
      key: result.key,
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.get('/audit', requireSuperAdmin, asyncHandler(async (req, res) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const guildId = typeof req.query.guildId === 'string' ? req.query.guildId : undefined;
  const audit = await runtimeConfigService.listAudit({ limit, guildId });
  res.json({
    data: audit,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

export default router;


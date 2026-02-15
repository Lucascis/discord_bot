import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId } from '../../middleware/validation.js';
import { requireGuildAdminOrSuperAdmin, getRuntimeAuthContext } from '../../middleware/runtime-config-auth.js';
import { runtimeConfigService } from '../../services/runtime-config-service.js';
import { ConfigActorRole } from '@discord-bot/database';

const router: ExpressRouter = Router();

const updateBodySchema = z.object({
  value: z.unknown(),
  reason: z.string().max(500).optional(),
});

router.get('/:guildId/runtime-config', validateGuildId, requireGuildAdminOrSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId } = req.params;
  const values = await runtimeConfigService.getEffectiveConfigForGuild(guildId);
  res.json({
    data: values,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
}));

router.put('/:guildId/runtime-config/:key', validateGuildId, requireGuildAdminOrSuperAdmin, asyncHandler(async (req, res) => {
  const { guildId, key } = req.params;
  const body = updateBodySchema.parse(req.body ?? {});
  const auth = await getRuntimeAuthContext(req);

  const result = await runtimeConfigService.updateGuildValue({
    actorDiscordUserId: auth.discordUserId,
    actorRole: auth.isSuperAdmin ? ConfigActorRole.SUPERADMIN : ConfigActorRole.GUILD_ADMIN,
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

export default router;

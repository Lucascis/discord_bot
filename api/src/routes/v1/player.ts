import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId } from '../../middleware/validation.js';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import { playerAudioClient } from '../../services/player-control-service.js';
import { prisma } from '@discord-bot/database';
import { ValidationError, NotFoundError } from '../../middleware/error-handler.js';
import Redis from 'ioredis';
import { z } from 'zod';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import ytdl from 'ytdl-core';
import { resolveGuildTier } from '../../services/effective-guild-tier.js';
import { requireGuildAdminOrSuperAdmin } from '../../middleware/runtime-config-auth.js';

const router: ExpressRouter = Router();
const redis = new Redis(env.REDIS_URL);

const STREAM_TOKEN_TTL_MS = 60000;
const STREAM_SECRET = env.PANEL_STREAM_SECRET || env.NEXTAUTH_SECRET || env.API_KEY;

const ACTIVE_INSTANCE_KEY = (guildId: string) => `discord-bot:active-instances:${guildId}`;
const PERSONAL_MODE_INSTANCE_LIMIT = 10;

const PLAN_INSTANCE_LIMITS: Record<string, number> = {
    FREE: 0,
    BASIC: 1,
    PREMIUM: 3,
    ENTERPRISE: 10
};

async function readActiveInstances(guildId: string): Promise<Record<string, string>> {
    const key = ACTIVE_INSTANCE_KEY(guildId);
    const keyType = await redis.type(key);

    if (keyType === 'none') {
        return {};
    }

    if (keyType === 'hash') {
        return await redis.hgetall(key);
    }

    if (keyType === 'set') {
        logger.warn({ guildId }, 'Detected legacy active instances set. Resetting to hash representation.');
        await redis.del(key);
        return {};
    }

    logger.warn({ guildId, keyType }, 'Unexpected Redis type for active instances. Resetting key.');
    await redis.del(key);
    return {};
}

async function writeActiveInstanceMapping(guildId: string, voiceChannelId: string, textChannelId: string) {
    const key = ACTIVE_INSTANCE_KEY(guildId);
    await redis.hset(key, voiceChannelId, textChannelId);
    await redis.expire(key, 3600);
}

async function resetActiveInstances(guildId: string) {
    const key = ACTIVE_INSTANCE_KEY(guildId);
    await redis.del(key);
}

function getPlanInstanceLimit(tier: string): number {
    if (env.NODE_ENV !== 'test') {
        // Non-commercial personal mode: keep advanced features enabled regardless of DB tier.
        return PERSONAL_MODE_INSTANCE_LIMIT;
    }
    const normalized = tier.toUpperCase();
    return PLAN_INSTANCE_LIMITS[normalized] ?? 1;
}

const playRequestSchema = z.object({
    query: z.string().min(2).max(200),
    mode: z.enum(['play', 'playnext', 'playnow']).optional(),
    voiceChannelId: z.string().regex(/^\d{17,19}$/).optional(),
    textChannelId: z.string().regex(/^\d{17,19}$/).optional(),
    userId: z.string().regex(/^\d{17,19}$/)
});

const controlSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('toggle') }),
    z.object({ action: z.literal('skip') }),
    z.object({ action: z.literal('stop') }),
    z.object({ action: z.literal('shuffle') }),
    z.object({ action: z.literal('clear') }),
    z.object({ action: z.literal('previous') }),
    z.object({ action: z.literal('mute') }),
    z.object({
        action: z.literal('volume'),
        value: z.number().int().min(0).max(200)
    }),
    z.object({
        action: z.literal('autoplay')
    }),
    z.object({
        action: z.literal('filter'),
        preset: z.string().min(1).max(32)
    })
]);

const summonSchema = z.object({
    voiceChannelId: z.string().regex(/^\d{17,19}$/, 'Invalid voice channel ID'),
    textChannelId: z.string().regex(/^\d{17,19}$/, 'Invalid text channel ID')
});

const NOW_PLAYING_KEY_PREFIX = 'discord-bot:now-playing:';

const enforceGuildScope = asyncHandler(async (req, res, next) => {
    const hasRuntimeIdentity = Boolean(req.headers['x-discord-user-id'] || req.headers['x-user-id']);
    if (!hasRuntimeIdentity) {
        next();
        return;
    }
    await requireGuildAdminOrSuperAdmin(req, res, next);
});

async function getCachedNowPlaying(guildId: string) {
    const raw = await redis.get(`${NOW_PLAYING_KEY_PREFIX}${guildId}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        logger.warn({ guildId }, 'Failed to parse cached now playing payload');
        return null;
    }
}

function createStreamToken(guildId: string) {
    if (!STREAM_SECRET) {
        throw new ValidationError('Stream token secret is not configured');
    }

    const expires = Date.now() + STREAM_TOKEN_TTL_MS;
    const payload = `${guildId}:${expires}`;
    const signature = crypto.createHmac('sha256', STREAM_SECRET).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ guildId, expires, signature })).toString('base64url');
    return { token, expires };
}

function verifyStreamToken(token: string | undefined, guildId: string) {
    if (!STREAM_SECRET) return false;
    if (!token) return false;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
        if (decoded.guildId !== guildId) return false;
        if (decoded.expires < Date.now()) return false;
        const expected = crypto.createHmac('sha256', STREAM_SECRET).update(`${decoded.guildId}:${decoded.expires}`).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(decoded.signature, 'hex'));
    } catch {
        return false;
    }
}

router.get('/:guildId/now-playing', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const state = await getCachedNowPlaying(guildId);
    const response = {
        data: state,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.get('/:guildId/events', validateGuildId, enforceGuildScope, async (req, res) => {
    const { guildId } = req.params;
    req.socket.setTimeout(0);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    res.flushHeaders?.();

    const subscriber = new Redis(env.REDIS_URL);
    const writePayload = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let closed = false;
    req.on('close', async () => {
        if (closed) return;
        closed = true;
        try {
            await subscriber.unsubscribe('discord-bot:ui:now');
            await subscriber.quit();
        } catch (error) {
            logger.warn({ error }, 'Failed to cleanup SSE subscriber');
        }
    });

    try {
        await subscriber.subscribe('discord-bot:ui:now');
        subscriber.on('message', async (_channel, message) => {
            try {
                const data = JSON.parse(message);
                if (data.guildId !== guildId) return;
                writePayload({ type: 'update', state: data });
            } catch (error) {
                logger.warn({ error }, 'Failed to parse UI event for SSE stream');
            }
        });

        const snapshot = await getCachedNowPlaying(guildId);
        writePayload({ type: 'snapshot', state: snapshot });
    } catch (error) {
        logger.error({ error, guildId }, 'Failed to initialize SSE channel');
        res.status(500).end();
    }
});

router.post('/:guildId/stream-token', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const token = createStreamToken(guildId);
    const response = {
        data: token,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.post('/:guildId/controls', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const payload = controlSchema.parse(req.body ?? {});

    switch (payload.action) {
        case 'toggle':
        case 'skip':
        case 'stop':
        case 'shuffle':
        case 'clear':
        case 'previous':
        case 'mute':
            await playerAudioClient.sendSimpleCommand(payload.action, guildId);
            break;
        case 'volume': {
            // Prefer direct absolute volume command to avoid extra Redis reads on control-path.
            await playerAudioClient.sendCommand('volume', guildId, { percent: payload.value });
            break;
        }
        case 'autoplay': {
            await playerAudioClient.sendCommand('autoplay', guildId);
            break;
        }
        case 'filter': {
            await playerAudioClient.sendCommand('filters', guildId, { action: 'apply', preset: payload.preset });
            break;
        }
        default:
            break;
    }

    const response = {
        data: { accepted: true },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.get('/:guildId/queue', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const pageRaw = typeof req.query.page === 'string' ? req.query.page : undefined;
    const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
    const queue = await playerAudioClient.sendQueueCommand(guildId, { page: Number.isFinite(page) && page > 0 ? page : 1 });
    const response = {
        data: queue,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.post('/:guildId/summon', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const payload = summonSchema.parse(req.body ?? {});

    const [serverConfig, guildRecord] = await Promise.all([
        prisma.serverConfiguration.findUnique({
            where: { guildId }
        }),
        prisma.guild.findUnique({
            where: { discordGuildId: guildId },
            select: {
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

    const tier = resolveGuildTier({
        guildId,
        serverConfigTier: serverConfig.subscriptionTier,
        guildSubscriptionTier: guildRecord?.subscription?.tier ?? null
    }).effectiveTier;

    const limit = getPlanInstanceLimit(tier);
    const activeInstances = await readActiveInstances(guildId);
    const activeEntries = Object.entries(activeInstances);

    const isDuplicateInstance = activeEntries.some(([voice, text]) => voice === payload.voiceChannelId && text === payload.textChannelId);

    if (!isDuplicateInstance && activeEntries.length >= limit) {
        if (limit === 1) {
            await resetActiveInstances(guildId);
            activeEntries.length = 0;
        } else {
            throw new ValidationError(`Alcanzaste el máximo de instancias activas (${limit}) en modo personal.`);
        }
    }

    const conflictingInstance = activeEntries.find(([voice, text]) => voice === payload.voiceChannelId || text === payload.textChannelId);
    if (conflictingInstance && !isDuplicateInstance) {
        if (limit === 1) {
            await resetActiveInstances(guildId);
        } else {
            throw new ValidationError('Ya hay una instancia del bot usando alguno de esos canales. Elegí otro par de voz/texto.');
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

    const response = {
        data: { accepted: true },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.get('/:guildId/instances', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;

    const [serverConfig, guildRecord] = await Promise.all([
        prisma.serverConfiguration.findUnique({
            where: { guildId }
        }),
        prisma.guild.findUnique({
            where: { discordGuildId: guildId },
            select: {
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

    const tier = resolveGuildTier({
        guildId,
        serverConfigTier: serverConfig.subscriptionTier,
        guildSubscriptionTier: guildRecord?.subscription?.tier ?? null
    }).effectiveTier;
    const limit = getPlanInstanceLimit(tier);
    const activeInstances = await readActiveInstances(guildId);
    const instances = Object.entries(activeInstances).map(([voiceChannelId, textChannelId]) => ({
        voiceChannelId,
        textChannelId
    }));

    const response = {
        data: {
            instances,
            tier: env.NODE_ENV !== 'test' ? 'PERSONAL' : tier,
            limit,
            availableSlots: Math.max(0, limit - instances.length)
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

async function resolveActiveChannels(guildId: string, voiceChannelId?: string, textChannelId?: string) {
    if (voiceChannelId && textChannelId) {
        return { voiceChannelId, textChannelId };
    }

    const activeInstances = await readActiveInstances(guildId);
    const entries = Object.entries(activeInstances);

    if (entries.length === 0) {
        throw new ValidationError('Invocá el bot a un canal desde el panel antes de reproducir música.');
    }

    const [firstVoice, firstText] = entries[0];
    const resolvedVoice = voiceChannelId ?? firstVoice;
    const resolvedText = textChannelId ?? activeInstances[resolvedVoice] ?? firstText;

    if (!resolvedText) {
        throw new ValidationError('No pudimos determinar el canal de texto donde publicar la UI.');
    }

    return { voiceChannelId: resolvedVoice, textChannelId: resolvedText };
}

router.post('/:guildId/play', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const payload = playRequestSchema.parse(req.body ?? {});

    const { voiceChannelId, textChannelId } = await resolveActiveChannels(guildId, payload.voiceChannelId, payload.textChannelId);

    await playerAudioClient.sendPlayCommand(payload.mode ?? 'play', guildId, voiceChannelId, textChannelId, payload.userId, payload.query);

    const response = {
        data: { accepted: true },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id']
    };
    res.json(response);
}));

router.get('/:guildId/stream', validateGuildId, enforceGuildScope, asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const token = req.query.token as string;

    if (!verifyStreamToken(token, guildId)) {
        res.status(401).json({ error: 'Invalid stream token' });
        return;
    }

    const state = await getCachedNowPlaying(guildId);
    if (!state || !state.uri || state.streamable === false) {
        res.status(404).json({ error: 'No playable source' });
        return;
    }

    res.set({
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked'
    });

    try {
        if (ytdl.validateURL(state.uri)) {
            const stream = ytdl(state.uri, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
            await pipeline(stream, res);
        } else {
            const upstream = await fetch(state.uri);
            if (!upstream.ok || !upstream.body) {
                res.status(502).end();
                return;
            }
            const nodeStream = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
            await pipeline(nodeStream, res);
        }
    } catch (error) {
        logger.error({
            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
            guildId,
            uri: state?.uri
        }, 'Failed to proxy audio stream');

        if (!res.headersSent) {
            res.status(500).end();
        } else {
            res.end();
        }
    }
}));

export default router;

import { logger } from '@discord-bot/logger';
import { prisma, subscriptionService } from '@discord-bot/database';
import { LlmService } from './llm-service.js';
import { TTLMap } from '@discord-bot/cache';
import { Player, Track } from 'lavalink-client';
import { featureFlagCache } from './cache.js';
import { AudioMetricsCollector } from './metrics.js';
import { batchQueueSaver } from '../performance.js';
import { saveQueue } from './database.js';
import {
    pickAutomixTrack
} from '../autoplay/recommendations.js';
import { LLTrack } from '../autoplay/recommendations.js';
import {
    seedRelatedQueue,
    seedByArtist,
    seedByGenre,
    seedMixed,
    LLPlayer
} from '../autoplay/seeds.js';
import {
    isBlockReason,
    ensurePlayback
} from '../autoplay/engine.js';
import { extractTrackInfo, TrackInfo } from '../utils/track.js';
import { setTimeout as delay } from 'node:timers/promises';

import { RedisManager } from '../infrastructure/redis/redis-manager.js';

export class AutoplayService {
    private autoplayCooldown: TTLMap<string, number>;

    constructor(
        private redisManager: RedisManager,
        private audioMetrics: AudioMetricsCollector,
        private llmService: LlmService
    ) {
        this.autoplayCooldown = new TTLMap<string, number>({
            maxSize: 200,           // Max 200 guilds
            defaultTTL: 180000,     // 3 minutes TTL (cooldown duration)
            cleanupInterval: 60000  // Cleanup every minute
        });
    }

    async isAutomixEnabledCached(guildId: string): Promise<boolean> {
        return await featureFlagCache.getOrSet(
            featureFlagCache.generateFlagKey(guildId, 'autoplay'),
            async () => {
                const enabled = await this.isAutomixEnabled(guildId);
                // Track feature flag usage for metrics
                this.audioMetrics.businessMetrics.trackFeatureUsage('autoplay_check', guildId);
                return enabled;
            },
            180000 // 3 minutes cache
        );
    }

    private async isAutomixEnabled(guildId: string): Promise<boolean> {
        try {
            const config = await prisma.serverConfiguration.findUnique({
                where: { guildId },
                select: { autoplayEnabled: true }
            });
            return !!config?.autoplayEnabled;
        } catch { return false; }
    }

    async getAutoplayConfigCached(guildId: string): Promise<{ enabled: boolean; mode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed' }> {
        const settings = await prisma.serverConfiguration.findUnique({
            where: { guildId },
            select: { autoplayEnabled: true, autoplayMode: true }
        });
        return {
            enabled: settings?.autoplayEnabled ?? false,
            mode: (settings?.autoplayMode || 'off') as 'off' | 'similar' | 'artist' | 'genre' | 'mixed'
        };
    }

    async seedAutoplayTracks(
        player: Player,
        current: { info?: { title?: string; author?: string; uri?: string } },
        mode: 'similar' | 'artist' | 'genre' | 'mixed',
        count: number
    ) {
        logger.info({
            guildId: player.guildId,
            mode,
            count,
            currentTrack: current.info?.title,
            hasPlayer: !!player,
            hasQueue: !!player.queue
        }, 'Seeding autoplay tracks');

        const searchFn = async (q: string) => {
            const res = await player.search({ query: q }, { id: 'automix' } as { id: string });
            return { tracks: res.tracks as unknown as LLTrack[] };
        };

        const baseTrack = current as unknown as LLTrack;
        let addedCount = 0;

        try {
            logger.info({ guildId: player.guildId, mode }, `About to call seed function for mode: ${mode}`);
            switch (mode) {
                case 'similar':
                    addedCount = await seedRelatedQueue(player as unknown as LLPlayer, baseTrack, searchFn, count);
                    break;
                case 'artist':
                    addedCount = await seedByArtist(player as unknown as LLPlayer, baseTrack, searchFn, count);
                    break;
                case 'genre':
                    addedCount = await seedByGenre(player as unknown as LLPlayer, baseTrack, searchFn, count);
                    break;
                case 'mixed':
                    addedCount = await seedMixed(player as unknown as LLPlayer, baseTrack, searchFn, count);
                    break;
                default:
                    logger.warn({ guildId: player.guildId, mode }, 'Unknown autoplay mode, defaulting to similar');
                    addedCount = await seedRelatedQueue(player as unknown as LLPlayer, baseTrack, searchFn, count);
            }

            // Trigger database save
            batchQueueSaver.scheduleUpdate(player.guildId, player);

            logger.info({ guildId: player.guildId, mode, requested: count, added: addedCount }, 'Finished seeding autoplay tracks');

            // Track autoplay success metric
            if (addedCount > 0) {
                this.audioMetrics.trackAutoplayRecommendation(player.guildId, mode, true);
            }
        } catch (error) {
            logger.error({
                error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
                guildId: player.guildId,
                mode
            }, 'Failed to seed autoplay tracks');
            this.audioMetrics.trackAutoplayRecommendation(player.guildId, mode, false);
        }

        return addedCount;
    }

    async enqueueAutomix(player: Player, last: { info?: { title?: string; author?: string; uri?: string; duration?: number } }) {
        const title = (last?.info?.title ?? '').trim();
        const author = (last?.info?.author ?? '').trim();
        const uri = last?.info?.uri ?? '';

        // Get autoplay configuration to respect user's selected mode
        const autoplayConfig = await this.getAutoplayConfigCached(player.guildId);
        const mode = autoplayConfig.mode === 'off' ? 'similar' : autoplayConfig.mode;

        // AI Recommendation Logic (Diamond Tier)
        let aiRecommendation: string | null = null;
        try {
            // Check if guild owner is Diamond
            const ownerId = (await prisma.guild.findUnique({ where: { id: player.guildId }, select: { ownerId: true } }))?.ownerId;
            if (ownerId) {
                const tier = await subscriptionService.getUserTier(ownerId);
                if (tier === 'DIAMOND') {
                    // Get recent tracks context (last 5)
                    // We don't have easy access to full history here without querying DB or cache
                    // For now, use the last track as context
                    if (title && author) {
                        aiRecommendation = await this.llmService.recommendNextTrack([`${author} - ${title}`]);
                        if (aiRecommendation) {
                            logger.info({ guildId: player.guildId, recommendation: aiRecommendation }, 'Using AI recommendation');
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn({ error: e }, 'Failed to get AI recommendation');
        }

        const pick = await pickAutomixTrack(
            async (q: string) => {
                // If AI recommended a song, search for it specifically
                const query = aiRecommendation || q;
                const res = await player.search({ query: query }, { id: 'automix' } as { id: string });
                return { tracks: res.tracks as unknown as LLTrack[] };
            },
            title,
            author,
            uri,
        );

        if (!pick) {
            logger.warn({ guildId: player.guildId, title, author, mode }, 'automix: no candidate found');

            // Track failed autoplay recommendation
            this.audioMetrics.trackAutoplayRecommendation(
                player.guildId,
                mode,
                false // Failed
            );

            return;
        }

        try {
            const info = extractTrackInfo(pick);
            logger.info({ guildId: player.guildId, nextTitle: info?.title, nextUri: info?.uri, mode }, 'automix: picked candidate');

            // Track successful autoplay recommendation
            this.audioMetrics.trackAutoplayRecommendation(
                player.guildId,
                mode,
                true,      // Success
                info?.title
            );

            // Track the autoplay song
            if (info) {
                this.audioMetrics.trackSongPlayback(
                    player.guildId,
                    {
                        title: info.title || 'Unknown',
                        duration: info.duration || 0,
                        source: 'youtube', // Default source
                        uri: info.uri,
                    },
                    true // Is autoplay
                );
            }

        } catch { /* ignore */ }

        await ensurePlayback(player as unknown as LLPlayer, pick as unknown as LLTrack);

        // Use seedAutoplayTracks to respect the user's selected autoplay mode
        try {
            const qlen = player.queue.tracks.length;
            if (qlen < 3) {
                const seeded = await this.seedAutoplayTracks(
                    player,
                    pick as { info?: { title?: string; author?: string; uri?: string } },
                    mode,
                    10
                );
                if (seeded > 0) logger.info({ guildId: player.guildId, seeded, mode }, 'automix: refilled tracks using configured mode');
            }
        } catch (e) {
            logger.error({ e, mode }, 'automix: failed to refill tracks');
        }
        await saveQueue(player.guildId, player);
    }

    async handleTrackEnd(player: Player, track: Track | null, reason?: string, pushIdleState?: (player: Player) => Promise<void>) {
        if (isBlockReason(reason)) { logger.info({ guildId: player.guildId, reason }, 'audio: track end blocked for autoplay'); return; }
        // Pequeña espera para que el estado del player/cola se estabilice
        await delay(900);
        // Cooldown por guild para evitar dobles triggers
        const now = Date.now();
        const last = this.autoplayCooldown.get(player.guildId) ?? 0;
        if (now - last < 1500) return;
        this.autoplayCooldown.set(player.guildId, now);
        // No ejecutar autoplay si loop de track está activo (queue loop debe permitir autoplay cuando se acaba la cola)
        if ((player.repeatMode ?? 'off') === 'track') return;
        // Si hay reproducción en curso o cola con elementos, no hacemos autoplay
        if (player.playing || player.queue.current || player.queue.tracks.length > 0) return;
        // Autoplay habilitado?
        const enabled = await this.isAutomixEnabledCached(player.guildId);
        if (!enabled) {
            logger.info({ guildId: player.guildId }, 'audio: autoplay disabled');
            // Nada en cola y autoplay off → publicar estado Idle para actualizar UI
            if (!(player.playing || player.queue.current) && player.queue.tracks.length === 0) {
                if (pushIdleState) await pushIdleState(player);
            }
            return;
        }

        // Enqueue one track to start playing immediately
        await this.enqueueAutomix(player, track as { info?: { title?: string; author?: string; uri?: string } });
    }

    getCooldownMap(): TTLMap<string, number> {
        return this.autoplayCooldown;
    }
}

import http from 'node:http';
import { env } from '@discord-bot/config';
import { logger, HealthChecker, CommonHealthChecks, getAdvancedHealthMonitor } from '@discord-bot/logger';
import { LavalinkManager } from '../lavalink/lavalink-manager.js';
import { RedisManager } from '../redis/redis-manager.js';
import { MonitoringService } from '../monitoring/monitoring-service.js';
import { AudioMetricsCollector } from '../../services/metrics.js';
import { audioCacheManager } from '../../services/cache.js';
import { adaptiveCacheManager } from '../../services/adaptive-cache.js';
import { predictiveCacheManager } from '../../services/predictive-cache.js';
import { PerformanceTracker, SearchThrottler } from '../../performance.js';
import { checkWorkerIntegrationHealth } from '../../services/worker-integration.js';
import { automixCache } from '../../cache.js';
import { LavalinkNode, Player } from 'lavalink-client';
import { Registry } from 'prom-client';
import { TTLMap } from '@discord-bot/cache';

export class HealthService {
    private server: http.Server;
    private healthChecker: HealthChecker;
    private advancedHealth = getAdvancedHealthMonitor();

    constructor(
        private lavalinkManager: LavalinkManager,
        private redisManager: RedisManager,
        private monitoringService: MonitoringService,
        private audioMetrics: AudioMetricsCollector,
        private registry: Registry,
        private autoplayCooldown: TTLMap<string, number>,
        private lastUiPush: TTLMap<string, number>
    ) {
        this.healthChecker = new HealthChecker('audio');
        this.healthChecker.register('redis', () => CommonHealthChecks.redis(this.redisManager.getPublisher()));

        this.server = http.createServer(this.handleRequest.bind(this));
    }

    public async initialize() {
        this.registerAdvancedHealthComponents();
        this.server.listen(env.AUDIO_HTTP_PORT, () => {
            logger.info(`Audio health on :${env.AUDIO_HTTP_PORT}`);
        });
    }

    public shutdown() {
        this.server.close();
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        if (!req.url) return;

        // Enhanced health endpoint
        if (req.url.startsWith('/health')) {
            await this.handleHealthRequest(req, res);
            return;
        }

        // Player statistics endpoint
        if (req.url.startsWith('/players')) {
            await this.handlePlayersRequest(req, res);
            return;
        }

        // Business metrics endpoint
        if (req.url.startsWith('/metrics/business')) {
            await this.handleBusinessMetricsRequest(req, res);
            return;
        }

        // Standard Prometheus metrics endpoint
        if (req.url.startsWith('/metrics')) {
            res.writeHead(200, { 'content-type': this.registry.contentType });
            res.end(await this.registry.metrics());
            return;
        }

        // Performance metrics endpoint
        if (req.url.startsWith('/performance')) {
            await this.handlePerformanceRequest(req, res);
            return;
        }

        // Cache statistics endpoint
        if (req.url.startsWith('/cache/stats')) {
            await this.handleCacheStatsRequest(req, res);
            return;
        }

        // Adaptive cache endpoint
        if (req.url.startsWith('/cache/adaptive')) {
            await this.handleAdaptiveCacheRequest(req, res);
            return;
        }

        // Predictive cache endpoint
        if (req.url.startsWith('/cache/predictive')) {
            await this.handlePredictiveCacheRequest(req, res);
            return;
        }

        res.writeHead(404); res.end();
    }

    private async handleHealthRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            if (req.url === '/health/advanced') {
                const healthChecks = new Map([
                    ['redis-circuit-breaker', () => this.advancedHealth.checkComponent('redis-circuit-breaker', async () => {
                        const metrics = this.redisManager.getPublisher().getMetrics();
                        return {
                            status: metrics.redisStatus === 'ready' ? 'healthy' : 'unhealthy',
                            message: `Redis circuit breaker status: ${metrics.redisStatus}`,
                            details: {
                                circuitState: metrics.state,
                                fallbackCacheSize: metrics.fallbackCache.size,
                                failures: metrics.failures,
                                successes: metrics.successes,
                            },
                        };
                    })],
                    ['lavalink-nodes', () => this.advancedHealth.checkComponent('lavalink-nodes', async () => {
                        const nodes = Array.from(this.lavalinkManager.library.nodeManager?.nodes.values() || []) as LavalinkNode[];
                        const connectedNodes = nodes.filter(node => node.connected);
                        const totalNodes = nodes.length;
                        const connectionRate = totalNodes > 0 ? connectedNodes.length / totalNodes : 0;

                        return {
                            status: connectionRate === 1 ? 'healthy' : connectionRate >= 0.5 ? 'degraded' : 'unhealthy',
                            message: `${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
                            details: { totalNodes, connectedNodes: connectedNodes.length, connectionRate },
                        };
                    })],
                    ['audio-performance', () => this.advancedHealth.checkComponent('audio-performance', async () => {
                        const memoryUsage = process.memoryUsage();
                        const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
                        const activePlayers = this.lavalinkManager.library.players.size;
                        const performanceScore = Math.max(0, 100 - heapUsagePercent - (activePlayers * 2));

                        return {
                            status: performanceScore > 70 ? 'healthy' : performanceScore > 40 ? 'degraded' : 'unhealthy',
                            message: `Performance score: ${performanceScore.toFixed(1)}%`,
                            details: { heapUsagePercent, activePlayers, performanceScore },
                        };
                    })],
                    ['worker-integration', () => this.advancedHealth.checkComponent('worker-integration', async () => {
                        const workerHealth = await checkWorkerIntegrationHealth();
                        return {
                            status: workerHealth.healthy ? 'healthy' : 'unhealthy',
                            message: workerHealth.healthy ? 'Worker Service integration operational' : 'Worker Service unavailable',
                            details: workerHealth.details,
                        };
                    })],
                ]);

                const componentResults = await this.advancedHealth.checkAllComponents(healthChecks);
                const componentStatuses = Array.from(componentResults.values());
                const unhealthyCount = componentStatuses.filter(c => c.status === 'unhealthy').length;
                const degradedCount = componentStatuses.filter(c => c.status === 'degraded').length;

                let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

                if (unhealthyCount > 0) overallStatus = 'unhealthy';
                else if (degradedCount > 0) overallStatus = 'degraded';

                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'audio',
                    status: overallStatus,
                    components: componentStatuses,
                    timestamp: new Date().toISOString(),
                }, null, 2));
            } else if (req.url === '/health/trends') {
                const trends = {
                    'redis-circuit-breaker': this.advancedHealth.getComponentTrends('redis-circuit-breaker', 30),
                    'lavalink-nodes': this.advancedHealth.getComponentTrends('lavalink-nodes', 30),
                    'audio-performance': this.advancedHealth.getComponentTrends('audio-performance', 30),
                    'worker-integration': this.advancedHealth.getComponentTrends('worker-integration', 30),
                };

                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(trends, null, 2));
            } else {
                const health = await this.healthChecker.check();
                const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
                res.writeHead(statusCode, { 'content-type': 'application/json' });
                res.end(JSON.stringify(health, null, 2));
            }
        } catch (error) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                service: 'audio',
                status: 'unhealthy',
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString(),
            }));
        }
    }

    private async handlePlayersRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const playerStats = [...(this.lavalinkManager.library.players.values() as IterableIterator<Player>)].map(player => ({
            guildId: player.guildId,
            connected: player.connected,
            playing: player.playing,
            paused: player.paused,
            queueSize: player.queue.tracks.length,
            current: player.queue.current?.info?.title || null,
        }));

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ players: playerStats, count: playerStats.length }));
    }

    private async handleBusinessMetricsRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            const prometheusMetrics = await this.audioMetrics.getPrometheusMetrics();
            res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
            res.end(prometheusMetrics);
        } catch (error) {
            logger.error({ error }, 'Failed to generate business metrics response');
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate business metrics' }));
        }
    }

    private async handlePerformanceRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const metrics = PerformanceTracker.getMetrics();
        const searchStats = SearchThrottler.getStats();
        const memoryStats = this.monitoringService.getMemoryStats();
        const cacheStats = audioCacheManager.getCacheStats();
        const businessInsights = this.audioMetrics.getBusinessInsights();
        const adaptiveAnalytics = adaptiveCacheManager.getPerformanceAnalytics();
        const predictiveAnalytics = predictiveCacheManager.getAnalytics();

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            performance: metrics,
            search: searchStats,
            memory: memoryStats,
            cache: cacheStats,
            business: businessInsights,
            adaptive: adaptiveAnalytics,
            predictive: predictiveAnalytics,
            timestamp: new Date().toISOString()
        }, null, 2));
    }

    private async handleCacheStatsRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const cacheStats = audioCacheManager.getCacheStats();
        const cacheSizes = audioCacheManager.getCacheSizes();

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            stats: cacheStats,
            sizes: cacheSizes,
            timestamp: new Date().toISOString()
        }, null, 2));
    }

    private async handleAdaptiveCacheRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        if (req.method === 'POST') {
            const optimization = await adaptiveCacheManager.optimizeCache();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(optimization, null, 2));
        } else {
            const analytics = adaptiveCacheManager.getPerformanceAnalytics();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(analytics, null, 2));
        }
    }

    private async handlePredictiveCacheRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const guildId = new URL(req.url!, 'http://localhost').searchParams.get('guildId');
        if (guildId) {
            const suggestions = await predictiveCacheManager.getPredictiveSearches('system', guildId);
            const recommendations = await adaptiveCacheManager.getGuildCacheRecommendations(guildId);

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                guildId,
                predictiveSearches: suggestions,
                cacheRecommendations: recommendations,
                analytics: predictiveCacheManager.getAnalytics(),
                timestamp: new Date().toISOString()
            }, null, 2));
        } else {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'guildId parameter required' }));
        }
    }

    private registerAdvancedHealthComponents() {
        this.advancedHealth.registerComponent('lavalink-nodes', async () => {
            const nodes = Array.from(this.lavalinkManager.library.nodeManager?.nodes.values() || []) as LavalinkNode[];
            const connectedNodes = nodes.filter(node => node.connected);
            const totalNodes = nodes.length;

            if (totalNodes === 0) {
                return {
                    status: 'unhealthy',
                    message: 'No Lavalink nodes configured',
                    details: { totalNodes: 0, connectedNodes: 0 },
                };
            }

            const connectionRate = connectedNodes.length / totalNodes;

            if (connectionRate === 1) {
                return {
                    status: 'healthy',
                    message: 'All Lavalink nodes connected',
                    details: {
                        totalNodes,
                        connectedNodes: connectedNodes.length,
                        connectionRate,
                        nodeDetails: nodes.map(node => ({
                            id: node.id,
                            connected: node.connected,
                            stats: node.stats,
                        })),
                    },
                };
            } else if (connectionRate >= 0.5) {
                return {
                    status: 'degraded',
                    message: `${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
                    details: {
                        totalNodes,
                        connectedNodes: connectedNodes.length,
                        connectionRate,
                        nodeDetails: nodes.map(node => ({
                            id: node.id,
                            connected: node.connected,
                            stats: node.stats,
                        })),
                    },
                };
            } else {
                return {
                    status: 'unhealthy',
                    message: `Critical: Only ${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
                    details: {
                        totalNodes,
                        connectedNodes: connectedNodes.length,
                        connectionRate,
                        nodeDetails: nodes.map(node => ({
                            id: node.id,
                            connected: node.connected,
                            stats: node.stats,
                        })),
                    },
                };
            }
        });

        this.advancedHealth.registerComponent('audio-performance', async () => {
            const memoryUsage = process.memoryUsage();
            const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
            const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
            const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

            const activePlayers = this.lavalinkManager.library.players.size;
            const totalTracks = Array.from(this.lavalinkManager.library.players.values() as IterableIterator<Player>).reduce(
                (sum, player) => sum + player.queue.tracks.length + (player.queue.current ? 1 : 0),
                0
            );

            const performanceScore = Math.max(0, 100 - heapUsagePercent - (activePlayers * 2));

            return {
                status: performanceScore > 70 ? 'healthy' : performanceScore > 40 ? 'degraded' : 'unhealthy',
                message: `Audio service performance score: ${performanceScore.toFixed(1)}%`,
                details: {
                    memory: {
                        heapUsedMB: heapUsedMB.toFixed(1),
                        heapTotalMB: heapTotalMB.toFixed(1),
                        heapUsagePercent: heapUsagePercent.toFixed(1),
                        external: (memoryUsage.external / 1024 / 1024).toFixed(1),
                    },
                    audio: {
                        activePlayers,
                        totalTracks,
                        performanceScore: performanceScore.toFixed(1),
                    },
                    uptime: process.uptime(),
                },
            };
        });

        this.advancedHealth.registerComponent('cache-performance', async () => {
            const cacheStats = {
                automixCacheSize: (automixCache as { size?: number }).size || 0,
                autoplayCooldownSize: this.autoplayCooldown.size,
                lastUiPushSize: this.lastUiPush.size,
            };

            return {
                status: 'healthy',
                message: 'Cache performance metrics',
                details: cacheStats,
            };
        });
    }
}

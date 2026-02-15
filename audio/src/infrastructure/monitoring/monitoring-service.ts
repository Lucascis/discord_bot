import { env } from '@discord-bot/config';
import { logger, initializeSentry } from '@discord-bot/logger';
import { MemoryManager } from '../../performance.js';
import { adaptiveCacheManager } from '../../services/adaptive-cache.js';
import { initializeWorkerIntegration } from '../../services/worker-integration.js';
import { audioStreamsMonitoring } from '@discord-bot/cache';
import { LavalinkManager } from '../lavalink/lavalink-manager.js';

export class MonitoringService {
    private globalTimers: { intervals: NodeJS.Timeout[]; timeouts: NodeJS.Timeout[] } = {
        intervals: [],
        timeouts: [],
    };

    constructor(private lavalinkManager: LavalinkManager) { }

    public async initialize(): Promise<void> {
        await this.initializeSentry();
        this.startMemoryMonitoring();
        this.startAdaptiveCacheMonitoring();
        await this.initializeWorkerIntegration();
        await this.initializeRedisStreamsMonitoring();
    }

    private async initializeSentry(): Promise<void> {
        await initializeSentry({
            ...(env.SENTRY_DSN && { dsn: env.SENTRY_DSN }),
            environment: env.SENTRY_ENVIRONMENT,
            serviceName: 'audio',
            tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
            profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE
        });
    }

    private startMemoryMonitoring(): void {
        const memoryManager = MemoryManager.getInstance();
        memoryManager.startMonitoring();
    }

    private startAdaptiveCacheMonitoring(): void {
        const interval = setInterval(() => {
            const memUsage = process.memoryUsage();

            // Use RSS-based calculation for better memory pressure detection
            const rssMB = memUsage.rss / 1024 / 1024;
            const memoryLimitMB = 512; // Reasonable limit for audio service
            const memoryPressurePercent = Math.min((rssMB / memoryLimitMB) * 100, 100);

            // Fallback to heap calculation if needed
            const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            const effectiveMemoryUsage = memoryPressurePercent > 0 ? memoryPressurePercent : heapUsagePercent;

            adaptiveCacheManager.recordMetrics({
                memoryUsage: effectiveMemoryUsage,
                activePlayers: this.lavalinkManager.library.players.size,
                timestamp: Date.now()
            });

            // Log high memory usage for debugging
            if (effectiveMemoryUsage > 85) {
                logger.debug({
                    rssMB: rssMB.toFixed(1),
                    memoryPressure: effectiveMemoryUsage.toFixed(1),
                    activePlayers: this.lavalinkManager.library.players.size
                }, 'High memory usage in audio service');
            }
        }, 60000); // Every minute

        this.globalTimers.intervals.push(interval);
    }

    private async initializeWorkerIntegration(): Promise<void> {
        try {
            await initializeWorkerIntegration();
            logger.info('Worker Service integration initialized successfully');
        } catch (error) {
            logger.error({ error }, 'Failed to initialize Worker Service integration - analytics disabled');
        }
    }

    private async initializeRedisStreamsMonitoring(): Promise<void> {
        try {
            await audioStreamsMonitoring.initialize();
            logger.info('Redis Streams monitoring initialized successfully');
        } catch (error) {
            logger.error({ error }, 'Failed to initialize Redis Streams monitoring');
        }
    }

    public shutdown(): void {
        this.globalTimers.intervals.forEach(clearInterval);
        this.globalTimers.timeouts.forEach(clearTimeout);
        MemoryManager.getInstance().stopMonitoring();
    }

    public getMemoryStats() {
        return MemoryManager.getInstance().getMemoryStats();
    }
}

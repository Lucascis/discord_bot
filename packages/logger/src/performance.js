import pino from 'pino';
import { loadavg } from 'os';
import { PerformanceObserver } from 'perf_hooks';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
import { EventEmitter } from 'events';
export class PerformanceMonitor extends EventEmitter {
    constructor(monitoringInterval = 30000) {
        super();
        this.monitoringInterval = monitoringInterval;
        this.gcStats = {
            collections: 0,
            totalDuration: 0,
            startTime: 0
        };
        this.eventLoopStart = process.hrtime.bigint();
        this.intervalId = null;
        this.setupGCMonitoring();
    }
    start() {
        if (this.intervalId) {
            return;
        }
        this.intervalId = setInterval(() => {
            const metrics = this.collectMetrics();
            this.emit('metrics', metrics);
            // Log warnings for high resource usage
            if (metrics.memory.heapUtilization > 0.9) {
                logger.warn({
                    heapUtilization: metrics.memory.heapUtilization,
                    heapUsed: Math.round(metrics.memory.heapUsed / 1024 / 1024) + 'MB'
                }, 'High memory usage detected');
            }
            if (metrics.eventLoop.lag > 100) {
                logger.warn({
                    lag: metrics.eventLoop.lag + 'ms'
                }, 'High event loop lag detected');
            }
            // Do not force GC from this generic monitor.
            // Manual GC in hot paths can introduce long pauses and audible glitches.
        }, this.monitoringInterval);
        logger.info({
            interval: this.monitoringInterval + 'ms'
        }, 'Performance monitoring started');
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info('Performance monitoring stopped');
        }
    }
    collectMetrics() {
        const memUsage = process.memoryUsage();
        const loadAverage = process.platform !== 'win32' ? loadavg() : [0, 0, 0];
        // Calculate event loop lag
        const currentTime = process.hrtime.bigint();
        const lag = Number(currentTime - this.eventLoopStart) / 1000000; // Convert to ms
        this.eventLoopStart = currentTime;
        return {
            memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                rss: memUsage.rss,
                heapUtilization: memUsage.heapUsed / memUsage.heapTotal
            },
            cpu: {
                loadAverage,
                processUptime: process.uptime()
            },
            gc: {
                collections: this.gcStats.collections,
                totalDuration: this.gcStats.totalDuration,
                averageDuration: this.gcStats.collections > 0
                    ? this.gcStats.totalDuration / this.gcStats.collections
                    : 0
            },
            eventLoop: {
                lag: lag,
                delay: lag
            }
        };
    }
    setupGCMonitoring() {
        if (!global.gc) {
            logger.debug('GC monitoring unavailable - run with --expose-gc flag');
            return;
        }
        // Hook into GC events if available
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const obs = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                for (const entry of entries) {
                    if (entry.entryType === 'gc') {
                        this.gcStats.collections++;
                        this.gcStats.totalDuration += entry.duration;
                        if (entry.duration > 100) {
                            logger.warn({
                                duration: Math.round(entry.duration) + 'ms',
                                kind: entry.detail?.kind || 'unknown'
                            }, 'Long GC pause detected');
                        }
                    }
                }
            });
            obs.observe({ entryTypes: ['gc'] });
        }
        catch (error) {
            logger.debug({ error }, 'Could not setup GC performance observer');
        }
    }
    // Memory leak detection
    createMemoryLeakDetector(thresholdMB = 500, samplesCount = 10) {
        const samples = [];
        const detector = setInterval(() => {
            const heapUsedMB = process.memoryUsage().heapUsed / 1024 / 1024;
            samples.push(heapUsedMB);
            if (samples.length > samplesCount) {
                samples.shift();
            }
            if (samples.length === samplesCount) {
                const trend = this.calculateTrend(samples);
                const currentUsage = samples[samples.length - 1];
                if (trend > 5 && currentUsage > thresholdMB) {
                    logger.error({
                        currentUsage: Math.round(currentUsage) + 'MB',
                        trend: `+${Math.round(trend)}MB over ${samplesCount} samples`,
                        threshold: thresholdMB + 'MB'
                    }, 'Potential memory leak detected');
                    this.emit('memoryLeak', {
                        currentUsage,
                        trend,
                        threshold: thresholdMB
                    });
                }
            }
        }, 60000); // Check every minute
        // Clean up detector on monitor stop
        this.on('stop', () => clearInterval(detector));
    }
    calculateTrend(samples) {
        if (samples.length < 2)
            return 0;
        const first = samples[0];
        const last = samples[samples.length - 1];
        return last - first;
    }
    // Connection pool monitoring
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static createConnectionPoolMonitor(poolName, getPoolStats) {
        setInterval(() => {
            const stats = getPoolStats();
            if (stats.waitingClients > 5) {
                logger.warn({
                    pool: poolName,
                    waiting: stats.waitingClients,
                    active: stats.activeClients,
                    idle: stats.idleClients
                }, `Connection pool bottleneck detected: ${poolName}`);
            }
        }, 30000);
    }
}
export const performanceMonitor = new PerformanceMonitor();

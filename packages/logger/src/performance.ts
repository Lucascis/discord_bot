import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
import { EventEmitter } from 'events';

export interface PerformanceMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    heapUtilization: number;
  };
  cpu: {
    loadAverage: number[];
    processUptime: number;
  };
  gc: {
    collections: number;
    totalDuration: number;
    averageDuration: number;
  };
  eventLoop: {
    lag: number;
    delay: number;
  };
}

export class PerformanceMonitor extends EventEmitter {
  private gcStats = {
    collections: 0,
    totalDuration: 0,
    startTime: 0
  };

  private eventLoopStart = process.hrtime.bigint();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(private monitoringInterval = 30000) {
    super();
    this.setupGCMonitoring();
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      const metrics = this.collectMetrics();
      this.emit('metrics', metrics);

      // Log warnings for high resource usage
      if (metrics.memory.heapUtilization > 0.9) {
        logger.warn('High memory usage detected', {
          heapUtilization: metrics.memory.heapUtilization,
          heapUsed: Math.round(metrics.memory.heapUsed / 1024 / 1024) + 'MB'
        });
      }

      if (metrics.eventLoop.lag > 100) {
        logger.warn('High event loop lag detected', {
          lag: metrics.eventLoop.lag + 'ms'
        });
      }

      // Force GC if memory usage is critically high
      if (metrics.memory.heapUtilization > 0.95 && global.gc) {
        logger.warn('Forcing garbage collection due to high memory usage');
        global.gc();
      }

    }, this.monitoringInterval);

    logger.info('Performance monitoring started', {
      interval: this.monitoringInterval + 'ms'
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Performance monitoring stopped');
    }
  }

  collectMetrics(): PerformanceMetrics {
    const memUsage = process.memoryUsage();
    const loadAverage = process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0];

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

  private setupGCMonitoring(): void {
    if (!global.gc) {
      logger.warn('GC monitoring unavailable - run with --expose-gc flag');
      return;
    }

    // Hook into GC events if available
    try {
      const { PerformanceObserver } = require('perf_hooks');
      const obs = new PerformanceObserver((list: any) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.entryType === 'gc') {
            this.gcStats.collections++;
            this.gcStats.totalDuration += entry.duration;

            if (entry.duration > 100) {
              logger.warn('Long GC pause detected', {
                duration: Math.round(entry.duration) + 'ms',
                kind: entry.detail?.kind || 'unknown'
              });
            }
          }
        }
      });
      obs.observe({ entryTypes: ['gc'] });
    } catch (error) {
      logger.warn('Could not setup GC performance observer', { error });
    }
  }

  // Memory leak detection
  createMemoryLeakDetector(thresholdMB = 500, samplesCount = 10): void {
    const samples: number[] = [];

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
          logger.error('Potential memory leak detected', {
            currentUsage: Math.round(currentUsage) + 'MB',
            trend: `+${Math.round(trend)}MB over ${samplesCount} samples`,
            threshold: thresholdMB + 'MB'
          });

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

  private calculateTrend(samples: number[]): number {
    if (samples.length < 2) return 0;

    const first = samples[0];
    const last = samples[samples.length - 1];
    return last - first;
  }

  // Connection pool monitoring
  static createConnectionPoolMonitor(poolName: string, getPoolStats: () => any): void {
    setInterval(() => {
      const stats = getPoolStats();

      if (stats.waitingClients > 5) {
        logger.warn(`Connection pool bottleneck detected: ${poolName}`, {
          pool: poolName,
          waiting: stats.waitingClients,
          active: stats.activeClients,
          idle: stats.idleClients
        });
      }
    }, 30000);
  }
}

export const performanceMonitor = new PerformanceMonitor();
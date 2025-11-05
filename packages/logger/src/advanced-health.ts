import { logger } from './index.js';
import type { HealthCheckResult } from './health.js';
import { loadavg } from 'node:os';
import v8 from 'node:v8';

export interface AdvancedHealthConfig {
  timeout: number;
  retryAttempts: number;
  warningThresholds: {
    responseTime: number;
    memoryUsage: number;
    cpuUsage: number;
  };
  criticalThresholds: {
    responseTime: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

export interface ComponentHealth {
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details: Record<string, unknown>;
  lastChecked: string;
  consecutiveFailures: number;
}

export interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    percentage: number;
    heap: {
      used: number;
      total: number;
      percentage: number;
    };
  };
  cpu: {
    percentage: number;
    loadAverage: number[];
  };
  uptime: number;
  gc: {
    collections: number;
    duration: number;
  };
}

/**
 * Advanced health monitoring with detailed system metrics and component tracking
 */
export class AdvancedHealthMonitor {
  private components = new Map<string, ComponentHealth>();
  private config: AdvancedHealthConfig;
  private lastGCMetrics = { collections: 0, duration: 0 };
  private healthHistory = new Map<string, HealthCheckResult[]>();
  private maxHistoryLength = 100;

  constructor(config: Partial<AdvancedHealthConfig> = {}) {
    this.config = {
      timeout: 5000,
      retryAttempts: 2,
      warningThresholds: {
        responseTime: 1000,
        memoryUsage: 75,
        cpuUsage: 70,
      },
      criticalThresholds: {
        responseTime: 5000,
        memoryUsage: 90,
        cpuUsage: 85,
      },
      ...config,
    };

    // Start GC monitoring if available
    this.initializeGCMonitoring();
  }

  /**
   * Register a component for health monitoring
   */
  registerComponent(
    name: string,
    healthCheck: () => Promise<HealthCheckResult>
  ): void {
    this.components.set(name, {
      component: name,
      status: 'healthy',
      responseTime: 0,
      details: {},
      lastChecked: new Date().toISOString(),
      consecutiveFailures: 0,
    });

    logger.info({ component: name }, 'Health component registered');
  }

  /**
   * Check health of a specific component with retry logic
   */
  async checkComponent(
    name: string,
    healthCheck: () => Promise<HealthCheckResult>
  ): Promise<ComponentHealth> {
    let component = this.components.get(name);
    if (!component) {
      // Auto-register component if not registered
      this.registerComponent(name, healthCheck);
      component = this.components.get(name)!;
    }

    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= this.config.retryAttempts) {
      const startTime = Date.now();

      try {
        const result = await Promise.race([
          healthCheck(),
          new Promise<HealthCheckResult>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout)
          ),
        ]);

        const responseTime = Date.now() - startTime;

        // Update component status
        component.status = this.determineStatus(result.status, responseTime);
        component.responseTime = responseTime;
        component.details = result.details || {};
        component.lastChecked = new Date().toISOString();
        component.consecutiveFailures = result.status === 'unhealthy' ? component.consecutiveFailures + 1 : 0;

        // Store in history
        this.addToHistory(name, { ...result, responseTime });

        logger.debug({
          component: name,
          status: component.status,
          responseTime,
          attempts: attempts + 1,
        }, 'Component health check completed');

        return component;

      } catch (error) {
        lastError = error as Error;
        attempts++;

        if (attempts <= this.config.retryAttempts) {
          logger.warn({
            component: name,
            attempt: attempts,
            error: lastError.message,
            retryIn: Math.pow(2, attempts) * 100,
          }, 'Health check failed, retrying');

          await this.delay(Math.pow(2, attempts) * 100); // Exponential backoff
        }
      }
    }

    // All attempts failed
    const responseTime = Date.now() - Date.now();
    component.status = 'unhealthy';
    component.responseTime = responseTime;
    component.details = { error: lastError?.message || 'Unknown error' };
    component.lastChecked = new Date().toISOString();
    component.consecutiveFailures++;

    logger.error({
      component: name,
      attempts,
      error: lastError?.message,
      consecutiveFailures: component.consecutiveFailures,
    }, 'Component health check failed after all retries');

    return component;
  }

  /**
   * Check health of all registered components
   */
  async checkAllComponents(
    healthChecks: Map<string, () => Promise<HealthCheckResult>>
  ): Promise<Map<string, ComponentHealth>> {
    const results = new Map<string, ComponentHealth>();

    // Run all health checks in parallel
    const checkPromises = Array.from(healthChecks.entries()).map(
      async ([name, healthCheck]) => {
        try {
          const result = await this.checkComponent(name, healthCheck);
          results.set(name, result);
        } catch (error) {
          logger.error({
            component: name,
            error: error instanceof Error ? error.message : String(error),
          }, 'Failed to check component health');

          results.set(name, {
            component: name,
            status: 'unhealthy',
            responseTime: 0,
            details: { error: error instanceof Error ? error.message : String(error) },
            lastChecked: new Date().toISOString(),
            consecutiveFailures: (this.components.get(name)?.consecutiveFailures || 0) + 1,
          });
        }
      }
    );

    await Promise.all(checkPromises);
    return results;
  }

  /**
   * Get comprehensive system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.rss + memUsage.external;

    return {
      memory: {
        used: totalMem,
        total: totalMem, // In Node.js, we approximate based on current usage
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        heap: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
          percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        },
      },
      cpu: {
        percentage: this.getCPUUsage(),
        loadAverage: loadavg(),
      },
      uptime: process.uptime(),
      gc: this.getGCMetrics(),
    };
  }

  /**
   * Get health summary with system context
   */
  getHealthSummary(): {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: ComponentHealth[];
    systemMetrics: SystemMetrics;
    alerts: Array<{ type: 'warning' | 'critical'; message: string; component?: string }>;
  } {
    const components = Array.from(this.components.values());
    const systemMetrics = this.getSystemMetrics();
    const alerts: Array<{ type: 'warning' | 'critical'; message: string; component?: string }> = [];

    // Determine overall status
    const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    }

    // Generate system alerts
    if (systemMetrics.memory.percentage > this.config.criticalThresholds.memoryUsage) {
      alerts.push({
        type: 'critical',
        message: `Critical memory usage: ${systemMetrics.memory.percentage.toFixed(1)}%`,
      });
    } else if (systemMetrics.memory.percentage > this.config.warningThresholds.memoryUsage) {
      alerts.push({
        type: 'warning',
        message: `High memory usage: ${systemMetrics.memory.percentage.toFixed(1)}%`,
      });
    }

    if (systemMetrics.cpu.percentage > this.config.criticalThresholds.cpuUsage) {
      alerts.push({
        type: 'critical',
        message: `Critical CPU usage: ${systemMetrics.cpu.percentage.toFixed(1)}%`,
      });
    } else if (systemMetrics.cpu.percentage > this.config.warningThresholds.cpuUsage) {
      alerts.push({
        type: 'warning',
        message: `High CPU usage: ${systemMetrics.cpu.percentage.toFixed(1)}%`,
      });
    }

    // Component-specific alerts
    for (const component of components) {
      if (component.consecutiveFailures >= 3) {
        alerts.push({
          type: 'critical',
          message: `Component ${component.component} has ${component.consecutiveFailures} consecutive failures`,
          component: component.component,
        });
      } else if (component.responseTime > this.config.criticalThresholds.responseTime) {
        alerts.push({
          type: 'critical',
          message: `Component ${component.component} response time is ${component.responseTime}ms`,
          component: component.component,
        });
      } else if (component.responseTime > this.config.warningThresholds.responseTime) {
        alerts.push({
          type: 'warning',
          message: `Component ${component.component} response time is ${component.responseTime}ms`,
          component: component.component,
        });
      }
    }

    return { overall, components, systemMetrics, alerts };
  }

  /**
   * Get health trends for a specific component
   */
  getComponentTrends(componentName: string, minutes: number = 30): {
    component: string;
    trends: {
      averageResponseTime: number;
      successRate: number;
      recentFailures: number;
    };
    history: HealthCheckResult[];
  } {
    const history = this.healthHistory.get(componentName) || [];
    const cutoffTime = Date.now() - (minutes * 60 * 1000);

    const recentHistory = history.filter(h =>
      h.responseTime && (Date.now() - h.responseTime) < cutoffTime
    );

    const successfulChecks = recentHistory.filter(h => h.status === 'healthy');
    const failedChecks = recentHistory.filter(h => h.status === 'unhealthy');

    const averageResponseTime = recentHistory.length > 0
      ? recentHistory.reduce((sum, h) => sum + (h.responseTime || 0), 0) / recentHistory.length
      : 0;

    const successRate = recentHistory.length > 0
      ? (successfulChecks.length / recentHistory.length) * 100
      : 100;

    return {
      component: componentName,
      trends: {
        averageResponseTime,
        successRate,
        recentFailures: failedChecks.length,
      },
      history: recentHistory,
    };
  }

  private determineStatus(
    checkStatus: 'healthy' | 'degraded' | 'unhealthy',
    responseTime: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (checkStatus === 'unhealthy') return 'unhealthy';

    if (responseTime > this.config.criticalThresholds.responseTime) {
      return 'unhealthy';
    }

    if (responseTime > this.config.warningThresholds.responseTime || checkStatus === 'degraded') {
      return 'degraded';
    }

    return 'healthy';
  }

  private addToHistory(componentName: string, result: HealthCheckResult): void {
    if (!this.healthHistory.has(componentName)) {
      this.healthHistory.set(componentName, []);
    }

    const history = this.healthHistory.get(componentName)!;
    history.push(result);

    // Keep only recent history
    if (history.length > this.maxHistoryLength) {
      history.splice(0, history.length - this.maxHistoryLength);
    }
  }

  private initializeGCMonitoring(): void {
    try {
      if (v8.getHeapStatistics) {
        // GC monitoring is available
        setInterval(() => {
          const gcStats = v8.getHeapStatistics();
          this.lastGCMetrics = {
            collections: gcStats.number_of_native_contexts || 0,
            duration: gcStats.peak_malloced_memory || 0,
          };
        }, 10000); // Every 10 seconds
      }
    } catch {
      logger.debug('GC monitoring not available');
    }
  }

  private getCPUUsage(): number {
    // Simplified CPU usage calculation
    // In a real implementation, you might want to use external libraries
    const loadAvg = loadavg();
    return Math.min(loadAvg[0] * 10, 100); // Rough approximation
  }

  private getGCMetrics(): { collections: number; duration: number } {
    return this.lastGCMetrics;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let healthMonitor: AdvancedHealthMonitor | null = null;

export function getAdvancedHealthMonitor(config?: Partial<AdvancedHealthConfig>): AdvancedHealthMonitor {
  if (!healthMonitor) {
    healthMonitor = new AdvancedHealthMonitor(config);
  }
  return healthMonitor;
}
import { logger } from '../logger/console-logger.js';
import { checkDatabaseHealth } from '@discord-bot/database';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    discord: HealthCheck;
    memory: HealthCheck;
  };
  uptime: number;
}

export interface HealthCheck {
  status: 'pass' | 'warn' | 'fail';
  responseTime?: number;
  output?: string;
}

export class ApplicationHealthChecker {
  private readonly startTime = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redisClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discordClient: any;

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(redisClient?: any, discordClient?: any) {
    this.redisClient = redisClient;
    this.discordClient = discordClient;
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDiscord(),
      this.checkMemory()
    ]);

    const [database, redis, discord, memory] = checks.map(result =>
      result.status === 'fulfilled' ? result.value : { status: 'fail' as const, output: 'Check failed' }
    );

    const overallStatus = this.calculateOverallStatus([database, redis, discord, memory]);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0', // Should come from package.json
      environment: process.env.NODE_ENV || 'development',
      checks: { database, redis, discord, memory },
      uptime: Date.now() - this.startTime
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();

    try {
      const health = await checkDatabaseHealth();
      const responseTime = Date.now() - startTime;

      if (health.status === 'healthy') {
        return {
          status: 'pass',
          responseTime,
          output: `Database healthy - ${health.metrics.queryCount} queries executed`
        };
      } else {
        return {
          status: 'fail',
          responseTime,
          output: `Database unhealthy - ${health.responseTime}ms response time`
        };
      }
    } catch (error) {
      return {
        status: 'fail',
        responseTime: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Database check failed'
      };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const startTime = Date.now();

    if (!this.redisClient) {
      return {
        status: 'warn',
        output: 'Redis client not configured'
      };
    }

    try {
      await this.redisClient.ping();
      const responseTime = Date.now() - startTime;

      return {
        status: 'pass',
        responseTime,
        output: 'Redis connection healthy'
      };
    } catch (error) {
      return {
        status: 'fail',
        responseTime: Date.now() - startTime,
        output: error instanceof Error ? error.message : 'Redis check failed'
      };
    }
  }

  private async checkDiscord(): Promise<HealthCheck> {
    if (!this.discordClient) {
      return {
        status: 'warn',
        output: 'Discord client not configured'
      };
    }

    try {
      // Check if client is ready according to Discord.js v14
      const isReady = this.discordClient.isReady();
      const ping = this.discordClient.ws?.ping ?? -1;
      const readyAt = this.discordClient.readyAt;

      // Primary check: isReady() is the definitive method for Discord.js v14
      if (isReady) {
        // Client is ready, check ping quality
        if (ping >= 0 && ping < 1000) {
          return {
            status: 'pass',
            responseTime: ping,
            output: `Discord WebSocket healthy - ${ping}ms ping, ready since ${readyAt?.toISOString() || 'unknown'}`
          };
        } else if (ping >= 1000) {
          return {
            status: 'warn',
            responseTime: ping,
            output: `Discord client ready but high latency: ${ping}ms`
          };
        } else {
          // ping is -1 (not available yet), but client is ready
          return {
            status: 'pass',
            output: `Discord client ready, ping not yet available (initializing)`
          };
        }
      } else {
        // Client is not ready yet
        return {
          status: 'warn',
          output: `Discord client initializing - isReady: ${isReady}, readyAt: ${readyAt}, ping: ${ping}ms`
        };
      }
    } catch (error) {
      return {
        status: 'fail',
        output: error instanceof Error ? error.message : 'Discord check failed'
      };
    }
  }

  private async checkMemory(): Promise<HealthCheck> {
    try {
      const usage = process.memoryUsage();
      const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
      const heapUsagePercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);
      const externalMB = Math.round(usage.external / 1024 / 1024);

      // Adjusted thresholds for Node.js memory management
      // Node.js memory usage patterns are different from other apps
      let status: 'pass' | 'warn' | 'fail';
      if (heapUsagePercent > 95) {
        status = 'fail'; // Critical memory usage
      } else if (heapUsagePercent > 90) {
        status = 'warn'; // High but manageable - increased from 85% to 90%
      } else {
        status = 'pass'; // Normal Node.js usage
      }

      return {
        status,
        output: `Memory: ${heapUsedMB}MB/${heapTotalMB}MB (${heapUsagePercent}%), External: ${externalMB}MB`
      };
    } catch (error) {
      return {
        status: 'fail',
        output: error instanceof Error ? error.message : 'Memory check failed'
      };
    }
  }

  private calculateOverallStatus(checks: HealthCheck[]): 'healthy' | 'degraded' | 'unhealthy' {
    const hasFailures = checks.some(check => check.status === 'fail');
    const warningChecks = checks.filter(check => check.status === 'warn');

    if (hasFailures) return 'unhealthy';

    // Only report degraded for critical warnings, not memory warnings
    const hasCriticalWarnings = warningChecks.some(check =>
      // Memory warnings at 85-95% are normal for Node.js
      // Only consider non-memory warnings as critical
      !check.output?.includes('Memory:')
    );

    if (hasCriticalWarnings) return 'degraded';
    return 'healthy';
  }

  async logHealthStatus(): Promise<void> {
    try {
      const health = await this.getHealthStatus();

      logger.info({
        health,
        service: 'gateway'
      }, `Health check completed - Status: ${health.status}`);

      // Log warnings for degraded services
      if (health.status !== 'healthy') {
        const failedChecks = Object.entries(health.checks)
          .filter(([_, check]) => check.status !== 'pass')
          .map(([name, check]) => `${name}: ${check.output}`);

        logger.warn({
          failedChecks,
          overallStatus: health.status
        }, 'Service degradation detected');
      }
    } catch (error) {
      logger.error({ error }, 'Health check logging failed');
    }
  }
}
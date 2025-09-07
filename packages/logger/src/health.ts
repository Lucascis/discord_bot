import { logger } from './index.js';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

// Database client interface
interface DatabaseClient {
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

// Redis client interface
interface RedisClient {
  ping(): Promise<string>;
}

// Discord client interface
interface DiscordClientStatus {
  isReady(): boolean;
  readyTimestamp: number | null;
  user?: { tag: string } | null;
  guilds: { cache: { size: number } };
  users: { cache: { size: number } };
  ws: { ping: number };
}

// Lavalink manager interface
interface LavalinkManager {
  nodeManager?: {
    nodes: Map<string, LavalinkNode>;
  };
}

interface LavalinkNode {
  id: string;
  connected: boolean;
  stats?: {
    cpu?: {
      systemLoad: number;
      lavalinkLoad: number;
    };
  };
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  uptime: number;
  timestamp: string;
  version: string;
  checks: Record<string, HealthCheckResult>;
  overall: HealthCheckResult;
}

/**
 * Health check manager for services
 */
export class HealthChecker {
  private checks = new Map<string, () => Promise<HealthCheckResult>>();
  private startTime = Date.now();

  constructor(
    private serviceName: string,
    private version: string = '1.0.0',
  ) {
    // Ensure startTime is set slightly in the past to avoid 0 uptime
    this.startTime = Date.now() - 1;
  }

  /**
   * Register a health check
   */
  register(name: string, check: () => Promise<HealthCheckResult>): void {
    this.checks.set(name, check);
  }

  /**
   * Run all health checks and return overall status
   */
  async check(): Promise<ServiceHealth> {
    const results: Record<string, HealthCheckResult> = {};
    const startTime = Date.now();

    // Run all checks in parallel
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, check]) => {
      const checkStart = Date.now();
      try {
        const result = await Promise.race([
          check(),
          new Promise<HealthCheckResult>((resolve) =>
            setTimeout(() => resolve({
              status: 'unhealthy',
              message: 'Health check timeout',
              responseTime: Date.now() - checkStart,
            }), 5000)
          )
        ]);
        
        // Override responseTime only if undefined or 0 (indicating it should be measured)
        if (!result.responseTime) {
          result.responseTime = Date.now() - checkStart;
        }
        results[name] = result;
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
          responseTime: Date.now() - checkStart,
        };
      }
    });

    await Promise.all(checkPromises);

    // Determine overall status
    const overall = this.calculateOverallStatus(results);
    const totalTime = Date.now() - startTime;

    const health: ServiceHealth = {
      service: this.serviceName,
      status: overall.status,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
      version: this.version,
      checks: results,
      overall: {
        ...overall,
        responseTime: totalTime,
      },
    };

    // Log health check results
    if (overall.status === 'unhealthy') {
      logger.error({ health }, 'Health check failed');
    } else if (overall.status === 'degraded') {
      logger.warn({ health }, 'Health check degraded');
    }

    return health;
  }

  private calculateOverallStatus(results: Record<string, HealthCheckResult>): HealthCheckResult {
    const statuses = Object.values(results).map(r => r.status);
    
    if (statuses.includes('unhealthy')) {
      return {
        status: 'unhealthy',
        message: 'One or more critical checks failed',
      };
    }
    
    if (statuses.includes('degraded')) {
      return {
        status: 'degraded',
        message: 'Some checks are degraded',
      };
    }
    
    return {
      status: 'healthy',
      message: 'All checks passed',
    };
  }
}

/**
 * Common health check functions
 */
export const CommonHealthChecks = {
  /**
   * Database connectivity check
   */
  async database(prisma: DatabaseClient): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        message: 'Database connection healthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  },

  /**
   * Redis connectivity check
   */
  async redis(client: RedisClient): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const result = await client.ping();
      if (result !== 'PONG') {
        return {
          status: 'unhealthy',
          message: 'Redis ping failed',
          responseTime: Date.now() - start,
        };
      }
      return {
        status: 'healthy',
        message: 'Redis connection healthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  },

  /**
   * Discord bot readiness check
   */
  async discordBot(client: DiscordClientStatus): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      if (!client.isReady()) {
        return {
          status: 'unhealthy',
          message: 'Discord client not ready',
          responseTime: Date.now() - start,
          details: {
            readyTimestamp: client.readyTimestamp,
            user: client.user?.tag,
          },
        };
      }

      const guildCount = client.guilds.cache.size;
      const userCount = client.users.cache.size;
      
      return {
        status: 'healthy',
        message: 'Discord client ready',
        responseTime: Date.now() - start,
        details: {
          guilds: guildCount,
          users: userCount,
          readyTimestamp: client.readyTimestamp,
          user: client.user?.tag,
          ping: client.ws.ping,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Discord check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  },

  /**
   * Lavalink nodes health check
   */
  async lavalink(manager: LavalinkManager): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const nodes = manager.nodeManager?.nodes || new Map();
      const nodeStatuses = Array.from(nodes.values()).map((node: LavalinkNode) => ({
        id: node.id,
        connected: node.connected,
        stats: node.stats,
      }));

      const connectedNodes = nodeStatuses.filter(n => n.connected);
      
      if (connectedNodes.length === 0) {
        return {
          status: 'unhealthy',
          message: 'No Lavalink nodes connected',
          responseTime: Date.now() - start,
          details: { nodes: nodeStatuses },
        };
      }

      const totalNodes = nodeStatuses.length;
      if (connectedNodes.length < totalNodes) {
        return {
          status: 'degraded',
          message: `${connectedNodes.length}/${totalNodes} Lavalink nodes connected`,
          responseTime: Date.now() - start,
          details: { nodes: nodeStatuses },
        };
      }

      // Check for high load conditions
      const highLoadNodes = connectedNodes.filter(node => {
        const stats = node.stats;
        if (stats && stats.cpu) {
          return stats.cpu.systemLoad > 0.8 || stats.cpu.lavalinkLoad > 0.7;
        }
        return false;
      });

      if (highLoadNodes.length > 0) {
        return {
          status: 'degraded',
          message: `High load detected`,
          responseTime: Date.now() - start,
          details: { nodes: nodeStatuses },
        };
      }

      return {
        status: 'healthy',
        message: `Lavalink nodes healthy`,
        responseTime: Date.now() - start,
        details: { nodes: nodeStatuses },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Lavalink check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  },

  /**
   * Memory usage check
   */
  async memory(maxMemoryMB: number = 1024): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const usage = process.memoryUsage();
      const usedMB = usage.heapUsed / 1024 / 1024;
      const totalMB = usage.heapTotal / 1024 / 1024;
      const usagePercent = (usedMB / maxMemoryMB) * 100;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let message = `Memory usage: ${usedMB.toFixed(1)}MB / ${maxMemoryMB}MB`;

      if (usagePercent > 90) {
        status = 'unhealthy';
        message = 'Critical memory usage';
      } else if (usagePercent > 75) {
        status = 'degraded';
        message = 'High memory usage';
      }

      return {
        status,
        message,
        responseTime: Date.now() - start,
        details: {
          heapUsed: `${usedMB.toFixed(1)}MB`,
          heapTotal: `${totalMB.toFixed(1)}MB`,
          external: `${(usage.external / 1024 / 1024).toFixed(1)}MB`,
          rss: `${(usage.rss / 1024 / 1024).toFixed(1)}MB`,
          usagePercent: `${usagePercent.toFixed(1)}%`,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Memory check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
      };
    }
  },
};
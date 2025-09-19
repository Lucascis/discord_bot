import express, { Request, Response, Express } from 'express';
import { ApplicationHealthChecker, HealthStatus } from '../health/application-health-checker.js';
import { logger } from '../logger/console-logger.js';

export class HealthServer {
  private app: Express;
  private server: any;
  private healthChecker: ApplicationHealthChecker;

  constructor(healthChecker: ApplicationHealthChecker, port: number = 3001) {
    this.app = express();
    this.healthChecker = healthChecker;
    this.setupRoutes();
    this.setupServer(port);
  }

  private setupRoutes(): void {
    // Basic health endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const health = await this.healthChecker.getHealthStatus();
        const statusCode = this.getHttpStatusFromHealth(health.status);

        res.status(statusCode).json(health);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.status(500).json({
          status: 'unhealthy',
          error: 'Health check failed'
        });
      }
    });

    // Liveness probe (simple)
    this.app.get('/live', (req: Request, res: Response) => {
      res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
      });
    });

    // Readiness probe (checks dependencies)
    this.app.get('/ready', async (req: Request, res: Response) => {
      try {
        const health = await this.healthChecker.getHealthStatus();

        // Service is ready if it's healthy or degraded (but not unhealthy)
        const isReady = health.status !== 'unhealthy';
        const statusCode = isReady ? 200 : 503;

        res.status(statusCode).json({
          status: isReady ? 'ready' : 'not-ready',
          health: health.status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Readiness check failed');
        res.status(503).json({
          status: 'not-ready',
          error: 'Readiness check failed'
        });
      }
    });

    // Detailed health information
    this.app.get('/health/detailed', async (req: Request, res: Response) => {
      try {
        const health = await this.healthChecker.getHealthStatus();
        const statusCode = this.getHttpStatusFromHealth(health.status);

        res.status(statusCode).json({
          ...health,
          metadata: {
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            ppid: process.ppid,
            memory_usage: process.memoryUsage(),
            cpu_usage: process.cpuUsage()
          }
        });
      } catch (error) {
        logger.error({ error }, 'Detailed health check failed');
        res.status(500).json({
          status: 'unhealthy',
          error: 'Health check failed'
        });
      }
    });

    // Metrics endpoint for Prometheus scraping
    this.app.get('/metrics', async (req: Request, res: Response) => {
      try {
        const health = await this.healthChecker.getHealthStatus();

        // Convert health data to Prometheus format
        const metrics = this.convertToPrometheusMetrics(health);

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.status(200).send(metrics);
      } catch (error) {
        logger.error({ error }, 'Metrics export failed');
        res.status(500).send('# Metrics export failed\n');
      }
    });
  }

  private setupServer(port: number): void {
    this.server = this.app.listen(port, () => {
      logger.info({ port }, 'Health server started');
    });

    this.server.on('error', (error: Error) => {
      logger.error({ error }, 'Health server error');
    });
  }

  private getHttpStatusFromHealth(status: HealthStatus['status']): number {
    switch (status) {
      case 'healthy': return 200;
      case 'degraded': return 200; // Still operational
      case 'unhealthy': return 503;
      default: return 500;
    }
  }

  private convertToPrometheusMetrics(health: HealthStatus): string {
    const metrics: string[] = [];

    // Service health status
    metrics.push('# HELP gateway_health_status Current health status of the gateway service');
    metrics.push('# TYPE gateway_health_status gauge');
    metrics.push(`gateway_health_status{status="${health.status}"} ${health.status === 'healthy' ? 1 : 0}`);

    // Service uptime
    metrics.push('# HELP gateway_uptime_seconds Service uptime in seconds');
    metrics.push('# TYPE gateway_uptime_seconds counter');
    metrics.push(`gateway_uptime_seconds ${Math.floor(health.uptime / 1000)}`);

    // Individual check statuses
    Object.entries(health.checks).forEach(([checkName, check]) => {
      metrics.push(`# HELP gateway_check_${checkName}_status Status of ${checkName} health check`);
      metrics.push(`# TYPE gateway_check_${checkName}_status gauge`);
      metrics.push(`gateway_check_${checkName}_status{status="${check.status}"} ${check.status === 'pass' ? 1 : 0}`);

      if (check.responseTime !== undefined) {
        metrics.push(`# HELP gateway_check_${checkName}_response_time_ms Response time for ${checkName} check`);
        metrics.push(`# TYPE gateway_check_${checkName}_response_time_ms gauge`);
        metrics.push(`gateway_check_${checkName}_response_time_ms ${check.responseTime}`);
      }
    });

    return metrics.join('\n') + '\n';
  }

  async shutdown(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health server shut down');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
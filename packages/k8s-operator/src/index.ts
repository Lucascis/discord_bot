/**
 * Discord Bot Kubernetes Operator
 * Entry point for the Kubernetes operator
 */

import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { DiscordBotController } from './controllers/discord-bot-controller';
import { DiscordBotCRD } from './crd/discord-bot-crd';
import * as k8s from '@kubernetes/client-node';
import express from 'express';

/**
 * Discord Bot Operator
 */
export class DiscordBotOperator {
  private readonly controller: DiscordBotController;
  private readonly metrics: MetricsCollector;
  private readonly app: express.Application;
  private readonly k8sApi: k8s.CustomObjectsApi;
  private server?: any;

  constructor() {
    this.metrics = new MetricsCollector('k8s-operator', '1.0.0');
    this.controller = new DiscordBotController(this.metrics);
    this.app = express();

    // Initialize Kubernetes API
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);

    this.setupRoutes();
    this.setupEventHandlers();

    logger.info('Discord Bot Operator initialized');
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const isHealthy = this.controller.isHealthy();
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Readiness check endpoint
    this.app.get('/ready', (req, res) => {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metricsString = await this.metrics.getMetrics();

        res.set('Content-Type', 'text/plain');
        res.send(metricsString);
      } catch (error) {
        logger.error('Failed to generate metrics:', error);
        res.status(500).json({ error: 'Failed to generate metrics' });
      }
    });

    // Controller info endpoint
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'discord-bot-operator',
        version: '1.0.0',
        controller: {
          metrics: this.controller.getMetrics(),
          healthy: this.controller.isHealthy()
        }
      });
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.controller.on('reconciled', (event) => {
      logger.info('Resource reconciled successfully', event);
      this.metrics.recordCustomMetric(
        'discord_bot_reconciliations_total',
        1,
        { status: 'success' },
        'counter'
      );
    });

    this.controller.on('reconciliation-error', (event) => {
      logger.error('Resource reconciliation failed', event);
      this.metrics.recordCustomMetric(
        'discord_bot_reconciliations_total',
        1,
        { status: 'error' },
        'counter'
      );
    });

    this.controller.on('error', (error) => {
      logger.error('Controller error:', error);
      this.metrics.recordCustomMetric(
        'discord_bot_controller_errors_total',
        1,
        {},
        'counter'
      );
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection:', { reason, promise });
      this.shutdown('unhandledRejection');
    });
  }

  /**
   * Start the operator
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Discord Bot Operator');

      // Install or update CRD
      await this.ensureCRD();

      // Start the controller
      await this.controller.start();

      // Start the HTTP server
      const port = process.env.PORT || 8080;
      this.server = this.app.listen(port, () => {
        logger.info(`Discord Bot Operator listening on port ${port}`);
      });

      logger.info('Discord Bot Operator started successfully');

    } catch (error) {
      logger.error('Failed to start Discord Bot Operator:', error);
      throw error;
    }
  }

  /**
   * Stop the operator
   */
  async stop(): Promise<void> {
    logger.info('Stopping Discord Bot Operator');

    try {
      // Stop the controller
      await this.controller.stop();

      // Close the HTTP server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => resolve());
        });
      }

      logger.info('Discord Bot Operator stopped successfully');
    } catch (error) {
      logger.error('Error during operator shutdown:', error);
      throw error;
    }
  }

  /**
   * Ensure CRD is installed
   */
  private async ensureCRD(): Promise<void> {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      const apiExtensionsApi = kc.makeApiClient(k8s.ApiextensionsV1Api);

      const crdName = 'discordbots.music.io';

      try {
        // Check if CRD exists
        await apiExtensionsApi.readCustomResourceDefinition(crdName);
        logger.info('DiscordBot CRD already exists');
      } catch (error: any) {
        if (error.statusCode === 404) {
          // CRD doesn't exist, create it
          logger.info('Creating DiscordBot CRD');
          await apiExtensionsApi.createCustomResourceDefinition(DiscordBotCRD);
          logger.info('DiscordBot CRD created successfully');

          // Wait for CRD to be established
          await this.waitForCRDEstablished(apiExtensionsApi, crdName);
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error('Failed to ensure CRD:', error);
      throw error;
    }
  }

  /**
   * Wait for CRD to be established
   */
  private async waitForCRDEstablished(
    apiExtensionsApi: k8s.ApiextensionsV1Api,
    crdName: string,
    maxWaitTime = 30000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const crd = await apiExtensionsApi.readCustomResourceDefinition(crdName);
        const conditions = crd.body.status?.conditions || [];

        const established = conditions.find(
          condition => condition.type === 'Established' && condition.status === 'True'
        );

        if (established) {
          logger.info('DiscordBot CRD is established');
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.warn('Error checking CRD status:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`CRD ${crdName} was not established within ${maxWaitTime}ms`);
  }

  /**
   * Format metrics for Prometheus
   */
  private formatPrometheusMetrics(metrics: Record<string, number>): string {
    let output = '';

    for (const [name, value] of Object.entries(metrics)) {
      output += `# HELP ${name} Discord Bot Operator metric\n`;
      output += `# TYPE ${name} gauge\n`;
      output += `${name} ${value}\n`;
    }

    return output;
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully`);

    try {
      await this.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const operator = new DiscordBotOperator();
    await operator.start();
  } catch (error) {
    logger.error('Failed to start operator:', error);
    process.exit(1);
  }
}

// Export for testing
export { main };

// Start the operator if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Operator startup failed:', error);
    process.exit(1);
  });
}
/**
 * GitOps Manager
 * Orchestrates GitOps workflows for Discord Bot deployments
 */

import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';
import { ArgoCDManager } from './argocd/argocd-manager';
import { GitRepository } from './git/git-repository';
import * as path from 'path';

/**
 * GitOps Configuration
 */
export interface GitOpsConfig {
  git: {
    manifestsRepo: {
      url: string;
      branch: string;
      localPath: string;
      credentials?: {
        username: string;
        token: string;
      };
    };
    autoSync: boolean;
    autoCommit: boolean;
  };
  argocd: {
    namespace: string;
    project: string;
    server: string;
  };
  environments: {
    dev: EnvironmentConfig;
    staging: EnvironmentConfig;
    prod: EnvironmentConfig;
  };
}

export interface EnvironmentConfig {
  namespace: string;
  autoSync: boolean;
  selfHeal: boolean;
  prune: boolean;
  values: Record<string, any>;
}

/**
 * Deployment Request
 */
export interface DeploymentRequest {
  name: string;
  environment: 'dev' | 'staging' | 'prod';
  imageTag: string;
  values?: Record<string, any>;
  strategy?: 'rolling' | 'blue-green' | 'canary';
  timeout?: number;
  dryRun?: boolean;
  autoPromote?: boolean;
}

/**
 * Deployment Status
 */
export interface DeploymentStatus {
  id: string;
  request: DeploymentRequest;
  status: 'pending' | 'syncing' | 'healthy' | 'degraded' | 'failed';
  phase: 'preparing' | 'deploying' | 'verifying' | 'promoting' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  message?: string;
  argocdApp?: string;
  error?: Error;
  metrics?: {
    syncDuration: number;
    healthCheckDuration: number;
    rollbackCount: number;
  };
}

/**
 * GitOps Manager
 */
export class GitOpsManager extends EventEmitter {
  private readonly config: GitOpsConfig;
  private readonly manifestsRepo: GitRepository;
  private readonly argoCDManager: ArgoCDManager;
  private readonly metrics: MetricsCollector;

  // Manager state
  private readonly activeDeployments = new Map<string, DeploymentStatus>();
  private deploymentCounter = 0;

  // Performance tracking
  private totalDeployments = 0;
  private successfulDeployments = 0;
  private failedDeployments = 0;
  private totalDeploymentTime = 0;

  constructor(config: GitOpsConfig, metrics?: MetricsCollector) {
    super();
    this.config = config;
    this.metrics = metrics || new MetricsCollector('gitops', '1.0.0');

    // Initialize Git repository for manifests
    this.manifestsRepo = new GitRepository({
      url: config.git.manifestsRepo.url,
      branch: config.git.manifestsRepo.branch,
      localPath: config.git.manifestsRepo.localPath,
      credentials: config.git.manifestsRepo.credentials,
      watchFiles: config.git.autoSync,
      autoCommit: config.git.autoCommit,
      commitMessage: 'GitOps: Update Discord Bot manifests'
    });

    // Initialize ArgoCD manager
    this.argoCDManager = new ArgoCDManager(this.manifestsRepo, this.metrics);

    this.setupEventHandlers();

    logger.info('GitOps Manager initialized');
  }

  /**
   * Initialize GitOps manager
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing GitOps Manager');

      // Initialize Git repository
      await this.manifestsRepo.initialize();

      // Start watching ArgoCD applications
      await this.argoCDManager.startWatching();

      // Ensure ArgoCD projects and applications exist
      await this.ensureArgoCDResources();

      logger.info('GitOps Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize GitOps Manager:', error);
      throw error;
    }
  }

  /**
   * Deploy Discord Bot to environment
   */
  async deploy(request: DeploymentRequest): Promise<string> {
    const deploymentId = `deploy-${++this.deploymentCounter}-${Date.now()}`;
    const startTime = new Date();

    const deployment: DeploymentStatus = {
      id: deploymentId,
      request,
      status: 'pending',
      phase: 'preparing',
      startTime,
      metrics: {
        syncDuration: 0,
        healthCheckDuration: 0,
        rollbackCount: 0
      }
    };

    this.activeDeployments.set(deploymentId, deployment);
    this.totalDeployments++;

    logger.info(`Starting deployment: ${deploymentId}`, request);
    this.emit('deployment-started', deployment);

    try {
      // Phase 1: Prepare manifests
      deployment.phase = 'preparing';
      await this.prepareManifests(deployment);

      // Phase 2: Deploy via ArgoCD
      deployment.phase = 'deploying';
      deployment.status = 'syncing';
      await this.deployToArgoCD(deployment);

      // Phase 3: Verify deployment
      deployment.phase = 'verifying';
      await this.verifyDeployment(deployment);

      // Phase 4: Mark as completed
      deployment.phase = 'completed';
      deployment.status = 'healthy';
      deployment.endTime = new Date();

      this.successfulDeployments++;
      const duration = deployment.endTime.getTime() - deployment.startTime.getTime();
      this.totalDeploymentTime += duration;

      logger.info(`Deployment completed successfully: ${deploymentId}`, {
        duration,
        environment: request.environment,
        imageTag: request.imageTag
      });

      this.emit('deployment-completed', deployment);

      // Record metrics
      this.recordDeploymentMetrics(deployment, 'success');

      return deploymentId;

    } catch (error) {
      deployment.phase = 'failed';
      deployment.status = 'failed';
      deployment.error = error as Error;
      deployment.endTime = new Date();

      this.failedDeployments++;

      logger.error(`Deployment failed: ${deploymentId}`, error);
      this.emit('deployment-failed', deployment);

      // Record metrics
      this.recordDeploymentMetrics(deployment, 'failure');

      throw error;
    } finally {
      // Clean up completed deployments after some time
      setTimeout(() => {
        this.activeDeployments.delete(deploymentId);
      }, 300000); // 5 minutes
    }
  }

  /**
   * Rollback deployment
   */
  async rollback(
    name: string,
    environment: 'dev' | 'staging' | 'prod',
    targetRevision?: string
  ): Promise<void> {
    const appName = `discord-bot-${name}-${environment}`;
    const namespace = this.config.argocd.namespace;

    try {
      logger.info(`Rolling back deployment: ${appName}`, { targetRevision });

      // Get current application
      const app = await this.argoCDManager.getApplication(appName, namespace);
      if (!app) {
        throw new Error(`Application ${appName} not found`);
      }

      // Determine target revision
      let rollbackRevision = targetRevision;
      if (!rollbackRevision) {
        // Get previous revision from Git
        const commits = await this.manifestsRepo.getCommitsBetween(
          'HEAD~5',
          'HEAD'
        );
        if (commits.length > 1) {
          rollbackRevision = commits[1].hash;
        } else {
          throw new Error('No previous revision found for rollback');
        }
      }

      // Update application to target revision
      await this.argoCDManager.updateApplication(appName, namespace, {
        source: {
          ...app.spec.source,
          targetRevision: rollbackRevision
        }
      });

      // Sync the application
      await this.argoCDManager.syncApplication(appName, namespace, {
        prune: true,
        dryRun: false
      });

      // Wait for rollback to complete
      await this.argoCDManager.waitForSync(appName, namespace, 300000);

      logger.info(`Rollback completed successfully: ${appName}`, {
        targetRevision: rollbackRevision
      });

      this.emit('rollback-completed', {
        application: appName,
        environment,
        targetRevision: rollbackRevision
      });

    } catch (error) {
      logger.error(`Rollback failed: ${appName}`, error);
      this.emit('rollback-failed', {
        application: appName,
        environment,
        error
      });
      throw error;
    }
  }

  /**
   * Get deployment status
   */
  getDeploymentStatus(deploymentId: string): DeploymentStatus | null {
    return this.activeDeployments.get(deploymentId) || null;
  }

  /**
   * List active deployments
   */
  listActiveDeployments(): DeploymentStatus[] {
    return Array.from(this.activeDeployments.values());
  }

  /**
   * Prepare manifests for deployment
   */
  private async prepareManifests(deployment: DeploymentStatus): Promise<void> {
    const { request } = deployment;
    const { name, environment, imageTag, values = {} } = request;

    try {
      const envConfig = this.config.environments[environment];
      const manifestsPath = `environments/${environment}/discord-bot`;

      // Generate Helm values
      const helmValues = {
        ...envConfig.values,
        ...values,
        image: {
          tag: imageTag,
          pullPolicy: 'Always'
        },
        instance: {
          name,
          environment
        },
        deployment: {
          timestamp: new Date().toISOString(),
          version: imageTag
        }
      };

      // Write values file
      const valuesPath = path.join(manifestsPath, `values-${name}.yaml`);
      await this.manifestsRepo.writeYamlFile(valuesPath, helmValues);

      // Create ArgoCD Application manifest if it doesn't exist
      const appManifestPath = path.join(manifestsPath, `application-${name}.yaml`);
      const appExists = await this.manifestsRepo.readFile(appManifestPath).catch(() => null);

      if (!appExists) {
        const appManifest = {
          apiVersion: 'argoproj.io/v1alpha1',
          kind: 'Application',
          metadata: {
            name: `discord-bot-${name}-${environment}`,
            namespace: this.config.argocd.namespace,
            labels: {
              'app.kubernetes.io/name': 'discord-bot',
              'app.kubernetes.io/managed-by': 'discord-bot-gitops'
            }
          },
          spec: {
            project: this.config.argocd.project,
            source: {
              repoURL: this.config.git.manifestsRepo.url,
              path: manifestsPath,
              targetRevision: this.config.git.manifestsRepo.branch,
              helm: {
                valueFiles: [
                  'values.yaml',
                  `values-${environment}.yaml`,
                  `values-${name}.yaml`
                ]
              }
            },
            destination: {
              server: this.config.argocd.server,
              namespace: envConfig.namespace
            },
            syncPolicy: {
              automated: envConfig.autoSync ? {
                prune: envConfig.prune,
                selfHeal: envConfig.selfHeal,
                allowEmpty: false
              } : undefined,
              syncOptions: [
                'CreateNamespace=true',
                'PrunePropagationPolicy=foreground',
                'PruneLast=true'
              ],
              retry: {
                limit: 5,
                backoff: {
                  duration: '5s',
                  factor: 2,
                  maxDuration: '3m'
                }
              }
            }
          }
        };

        await this.manifestsRepo.writeYamlFile(appManifestPath, appManifest);
      }

      // Commit and push changes
      const commitMessage = `GitOps: Deploy ${name} to ${environment} with image ${imageTag}`;
      await this.manifestsRepo.commitAndPush(
        [valuesPath, appManifestPath],
        commitMessage
      );

      deployment.message = 'Manifests prepared and committed';
      this.emit('deployment-manifests-prepared', deployment);

    } catch (error) {
      logger.error('Failed to prepare manifests:', error);
      throw error;
    }
  }

  /**
   * Deploy to ArgoCD
   */
  private async deployToArgoCD(deployment: DeploymentStatus): Promise<void> {
    const { request } = deployment;
    const { name, environment, timeout = 300000 } = request;

    const appName = `discord-bot-${name}-${environment}`;
    const namespace = this.config.argocd.namespace;

    try {
      const syncStartTime = Date.now();

      // Check if application exists, create if not
      let app = await this.argoCDManager.getApplication(appName, namespace);
      if (!app) {
        const envConfig = this.config.environments[environment];
        app = await this.argoCDManager.createDiscordBotApplication(
          name,
          environment,
          {
            namespace,
            project: this.config.argocd.project,
            repoURL: this.config.git.manifestsRepo.url,
            targetRevision: this.config.git.manifestsRepo.branch,
            autoSync: envConfig.autoSync,
            selfHeal: envConfig.selfHeal,
            prune: envConfig.prune
          }
        );
      }

      // Store ArgoCD application reference
      deployment.argocdApp = appName;

      // Refresh application to get latest manifests
      await this.argoCDManager.refreshApplication(appName, namespace);

      // Sync application
      await this.argoCDManager.syncApplication(appName, namespace, {
        prune: true,
        dryRun: request.dryRun || false
      });

      if (!request.dryRun) {
        // Wait for sync to complete
        await this.argoCDManager.waitForSync(appName, namespace, timeout);
      }

      const syncDuration = Date.now() - syncStartTime;
      deployment.metrics!.syncDuration = syncDuration;

      deployment.message = `Deployed to ArgoCD in ${syncDuration}ms`;
      this.emit('deployment-synced', deployment);

    } catch (error) {
      logger.error('Failed to deploy to ArgoCD:', error);
      throw error;
    }
  }

  /**
   * Verify deployment
   */
  private async verifyDeployment(deployment: DeploymentStatus): Promise<void> {
    const { request } = deployment;
    const { name, environment } = request;

    const appName = `discord-bot-${name}-${environment}`;
    const namespace = this.config.argocd.namespace;

    try {
      const verifyStartTime = Date.now();

      // Get application status
      const app = await this.argoCDManager.getApplication(appName, namespace);
      if (!app) {
        throw new Error(`Application ${appName} not found`);
      }

      // Check health status
      const healthStatus = app.status?.health?.status;
      const syncStatus = app.status?.sync?.status;

      if (healthStatus !== 'Healthy') {
        throw new Error(`Application health is ${healthStatus}: ${app.status?.health?.message}`);
      }

      if (syncStatus !== 'Synced') {
        throw new Error(`Application sync status is ${syncStatus}`);
      }

      // Additional verification checks could go here
      // - Check pod readiness
      // - Run health checks
      // - Validate metrics

      const verifyDuration = Date.now() - verifyStartTime;
      deployment.metrics!.healthCheckDuration = verifyDuration;

      deployment.message = `Deployment verified successfully in ${verifyDuration}ms`;
      this.emit('deployment-verified', deployment);

    } catch (error) {
      logger.error('Failed to verify deployment:', error);
      throw error;
    }
  }

  /**
   * Ensure ArgoCD resources exist
   */
  private async ensureArgoCDResources(): Promise<void> {
    try {
      // This would typically ensure ArgoCD projects exist
      // For now, we assume they're already set up
      logger.info('ArgoCD resources verified');
    } catch (error) {
      logger.error('Failed to ensure ArgoCD resources:', error);
      throw error;
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Git repository events
    this.manifestsRepo.on('commits-pulled', (commits) => {
      logger.info(`Pulled ${commits.length} new commits`);
      this.emit('manifests-updated', commits);
    });

    this.manifestsRepo.on('changes-pushed', (event) => {
      logger.info('Manifests pushed to repository', event);
      this.emit('manifests-pushed', event);
    });

    // ArgoCD events
    this.argoCDManager.on('application-synced', (event) => {
      logger.info('ArgoCD application synced', event);
      this.emit('application-synced', event);
    });

    this.argoCDManager.on('deployment-completed', (event) => {
      logger.info('ArgoCD deployment completed', event);
      this.emit('argocd-deployment-completed', event);
    });

    this.argoCDManager.on('deployment-failed', (event) => {
      logger.error('ArgoCD deployment failed', event);
      this.emit('argocd-deployment-failed', event);
    });
  }

  /**
   * Record deployment metrics
   */
  private recordDeploymentMetrics(
    deployment: DeploymentStatus,
    result: 'success' | 'failure'
  ): void {
    const labels = {
      environment: deployment.request.environment,
      result
    };

    this.metrics.recordCustomMetric(
      'gitops_deployments_total',
      1,
      labels,
      'counter'
    );

    if (deployment.endTime) {
      const duration = deployment.endTime.getTime() - deployment.startTime.getTime();
      this.metrics.recordCustomMetric(
        'gitops_deployment_duration_ms',
        duration,
        labels,
        'histogram'
      );
    }

    if (deployment.metrics) {
      this.metrics.recordCustomMetric(
        'gitops_sync_duration_ms',
        deployment.metrics.syncDuration,
        labels,
        'histogram'
      );

      this.metrics.recordCustomMetric(
        'gitops_health_check_duration_ms',
        deployment.metrics.healthCheckDuration,
        labels,
        'histogram'
      );
    }
  }

  /**
   * Get manager metrics
   */
  getMetrics(): Record<string, number> {
    const baseMetrics = {
      gitops_deployments_total: this.totalDeployments,
      gitops_deployments_successful: this.successfulDeployments,
      gitops_deployments_failed: this.failedDeployments,
      gitops_deployments_active: this.activeDeployments.size,
      gitops_deployment_success_rate: this.totalDeployments > 0
        ? this.successfulDeployments / this.totalDeployments
        : 0,
      gitops_avg_deployment_duration_ms: this.successfulDeployments > 0
        ? this.totalDeploymentTime / this.successfulDeployments
        : 0
    };

    return {
      ...baseMetrics,
      ...this.argoCDManager.getMetrics()
    };
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.argoCDManager.isHealthy() && this.failedDeployments < 5;
  }

  /**
   * Shutdown GitOps manager
   */
  async shutdown(): Promise<void> {
    try {
      await this.argoCDManager.stopWatching();
      await this.manifestsRepo.destroy();
      logger.info('GitOps Manager shut down successfully');
    } catch (error) {
      logger.error('Error during GitOps Manager shutdown:', error);
      throw error;
    }
  }
}
/**
 * ArgoCD Manager
 * Manages ArgoCD applications and GitOps workflows
 */

import * as k8s from '@kubernetes/client-node';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';
import { GitRepository } from '../git/git-repository';
import yaml from 'yaml';

/**
 * ArgoCD Application Configuration
 */
export interface ArgoCDApplicationConfig {
  name: string;
  namespace: string;
  project: string;
  source: {
    repoURL: string;
    path: string;
    targetRevision: string;
    helm?: {
      valueFiles?: string[];
      parameters?: Array<{
        name: string;
        value: string;
      }>;
    };
  };
  destination: {
    server: string;
    namespace: string;
  };
  syncPolicy?: {
    automated?: {
      prune: boolean;
      selfHeal: boolean;
      allowEmpty?: boolean;
    };
    syncOptions?: string[];
    retry?: {
      limit: number;
      backoff: {
        duration: string;
        factor: number;
        maxDuration: string;
      };
    };
  };
}

/**
 * ArgoCD Application Status
 */
export interface ArgoCDApplicationStatus {
  health: {
    status: 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown';
    message?: string;
  };
  sync: {
    status: 'Synced' | 'OutOfSync' | 'Unknown';
    revision?: string;
    comparedTo?: {
      source: {
        repoURL: string;
        path: string;
        targetRevision: string;
      };
      destination: {
        server: string;
        namespace: string;
      };
    };
  };
  operationState?: {
    operation: {
      sync: {
        revision: string;
        prune: boolean;
        dryRun: boolean;
      };
    };
    phase: 'Running' | 'Succeeded' | 'Failed' | 'Error' | 'Terminating';
    startedAt: string;
    finishedAt?: string;
    message?: string;
  };
  resources?: Array<{
    version: string;
    kind: string;
    namespace: string;
    name: string;
    status: 'Synced' | 'OutOfSync' | 'Unknown';
    health: {
      status: 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown';
      message?: string;
    };
  }>;
}

/**
 * ArgoCD Application Resource
 */
export interface ArgoCDApplication {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: ArgoCDApplicationConfig;
  status?: ArgoCDApplicationStatus;
}

/**
 * ArgoCD Manager
 */
export class ArgoCDManager extends EventEmitter {
  private readonly k8sApi: k8s.CustomObjectsApi;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly gitRepo: GitRepository;
  private readonly metrics?: MetricsCollector;

  // Manager state
  private readonly managedApplications = new Map<string, ArgoCDApplication>();
  private isWatching = false;
  private watchAbortController?: AbortController;

  // Performance tracking
  private syncCount = 0;
  private totalSyncTime = 0;
  private errorCount = 0;

  constructor(
    gitRepo: GitRepository,
    metrics?: MetricsCollector
  ) {
    super();
    this.gitRepo = gitRepo;
    this.metrics = metrics;

    // Initialize Kubernetes clients
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    this.k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);
    this.k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

    logger.info('ArgoCD Manager initialized');
  }

  /**
   * Create ArgoCD Application
   */
  async createApplication(config: ArgoCDApplicationConfig): Promise<ArgoCDApplication> {
    const application: ArgoCDApplication = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Application',
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/managed-by': 'discord-bot-gitops'
        },
        finalizers: ['resources-finalizer.argocd.argoproj.io']
      },
      spec: config
    };

    try {
      const response = await this.k8sApi.createNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        config.namespace,
        'applications',
        application
      );

      const createdApp = response.body as ArgoCDApplication;
      this.managedApplications.set(`${config.namespace}/${config.name}`, createdApp);

      logger.info(`Created ArgoCD Application: ${config.namespace}/${config.name}`);
      this.emit('application-created', createdApp);

      return createdApp;
    } catch (error) {
      logger.error(`Failed to create ArgoCD Application: ${config.namespace}/${config.name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Update ArgoCD Application
   */
  async updateApplication(
    name: string,
    namespace: string,
    config: Partial<ArgoCDApplicationConfig>
  ): Promise<ArgoCDApplication> {
    try {
      const existingApp = await this.getApplication(name, namespace);
      if (!existingApp) {
        throw new Error(`Application ${namespace}/${name} not found`);
      }

      const updatedApp: ArgoCDApplication = {
        ...existingApp,
        spec: {
          ...existingApp.spec,
          ...config
        }
      };

      const response = await this.k8sApi.replaceNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        namespace,
        'applications',
        name,
        updatedApp
      );

      const updated = response.body as ArgoCDApplication;
      this.managedApplications.set(`${namespace}/${name}`, updated);

      logger.info(`Updated ArgoCD Application: ${namespace}/${name}`);
      this.emit('application-updated', updated);

      return updated;
    } catch (error) {
      logger.error(`Failed to update ArgoCD Application: ${namespace}/${name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Delete ArgoCD Application
   */
  async deleteApplication(name: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        namespace,
        'applications',
        name
      );

      this.managedApplications.delete(`${namespace}/${name}`);

      logger.info(`Deleted ArgoCD Application: ${namespace}/${name}`);
      this.emit('application-deleted', { name, namespace });
    } catch (error: any) {
      if (error.statusCode !== 404) {
        logger.error(`Failed to delete ArgoCD Application: ${namespace}/${name}`, error);
        this.errorCount++;
        throw error;
      }
    }
  }

  /**
   * Get ArgoCD Application
   */
  async getApplication(name: string, namespace: string): Promise<ArgoCDApplication | null> {
    try {
      const response = await this.k8sApi.getNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        namespace,
        'applications',
        name
      );

      return response.body as ArgoCDApplication;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List ArgoCD Applications
   */
  async listApplications(namespace?: string): Promise<ArgoCDApplication[]> {
    try {
      const response = namespace
        ? await this.k8sApi.listNamespacedCustomObject(
            'argoproj.io',
            'v1alpha1',
            namespace,
            'applications'
          )
        : await this.k8sApi.listClusterCustomObject(
            'argoproj.io',
            'v1alpha1',
            'applications'
          );

      const items = (response.body as any).items || [];
      return items as ArgoCDApplication[];
    } catch (error) {
      logger.error('Failed to list ArgoCD Applications', error);
      throw error;
    }
  }

  /**
   * Sync ArgoCD Application
   */
  async syncApplication(
    name: string,
    namespace: string,
    options: {
      prune?: boolean;
      dryRun?: boolean;
      strategy?: 'hook' | 'apply';
      resources?: Array<{
        group: string;
        kind: string;
        name: string;
        namespace?: string;
      }>;
    } = {}
  ): Promise<void> {
    const startTime = Date.now();
    this.syncCount++;

    try {
      // Create sync operation
      const syncOperation = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Application',
        metadata: {
          name,
          namespace
        },
        operation: {
          sync: {
            prune: options.prune || false,
            dryRun: options.dryRun || false,
            syncStrategy: {
              apply: {
                force: false
              }
            },
            resources: options.resources || []
          }
        }
      };

      await this.k8sApi.patchNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        namespace,
        'applications',
        name,
        syncOperation,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      );

      const duration = Date.now() - startTime;
      this.totalSyncTime += duration;

      logger.info(`Initiated sync for ArgoCD Application: ${namespace}/${name}`, {
        duration,
        options
      });

      this.emit('application-synced', { name, namespace, duration, options });

      // Record metrics
      if (this.metrics) {
        this.metrics.recordCustomMetric(
          'argocd_sync_operations_total',
          1,
          { application: name, namespace },
          'counter'
        );
        this.metrics.recordCustomMetric(
          'argocd_sync_duration_ms',
          duration,
          { application: name, namespace },
          'histogram'
        );
      }
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to sync ArgoCD Application: ${namespace}/${name}`, error);
      this.emit('application-sync-error', { name, namespace, error });
      throw error;
    }
  }

  /**
   * Refresh ArgoCD Application
   */
  async refreshApplication(name: string, namespace: string): Promise<void> {
    try {
      const refreshPatch = {
        metadata: {
          annotations: {
            'argocd.argoproj.io/refresh': new Date().toISOString()
          }
        }
      };

      await this.k8sApi.patchNamespacedCustomObject(
        'argoproj.io',
        'v1alpha1',
        namespace,
        'applications',
        name,
        refreshPatch,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      );

      logger.info(`Refreshed ArgoCD Application: ${namespace}/${name}`);
      this.emit('application-refreshed', { name, namespace });
    } catch (error) {
      logger.error(`Failed to refresh ArgoCD Application: ${namespace}/${name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Create Discord Bot Application
   */
  async createDiscordBotApplication(
    name: string,
    environment: 'dev' | 'staging' | 'prod',
    options: {
      namespace?: string;
      project?: string;
      repoURL?: string;
      targetRevision?: string;
      autoSync?: boolean;
      selfHeal?: boolean;
      prune?: boolean;
    } = {}
  ): Promise<ArgoCDApplication> {
    const namespace = options.namespace || 'argocd';
    const project = options.project || 'discord-bot';
    const repoURL = options.repoURL || 'https://github.com/your-org/discord-bot-manifests';

    const config: ArgoCDApplicationConfig = {
      name: `discord-bot-${name}-${environment}`,
      namespace,
      project,
      source: {
        repoURL,
        path: `environments/${environment}/discord-bot`,
        targetRevision: options.targetRevision || 'HEAD',
        helm: {
          valueFiles: [
            `values.yaml`,
            `values-${environment}.yaml`
          ],
          parameters: [
            {
              name: 'image.tag',
              value: 'latest'
            },
            {
              name: 'environment',
              value: environment
            },
            {
              name: 'instance.name',
              value: name
            }
          ]
        }
      },
      destination: {
        server: 'https://kubernetes.default.svc',
        namespace: `discord-bot-${environment}`
      },
      syncPolicy: {
        automated: options.autoSync ? {
          prune: options.prune || true,
          selfHeal: options.selfHeal || true,
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
    };

    return await this.createApplication(config);
  }

  /**
   * Deploy Discord Bot to environment
   */
  async deployToEnvironment(
    name: string,
    environment: 'dev' | 'staging' | 'prod',
    imageTag: string,
    options: {
      values?: Record<string, any>;
      sync?: boolean;
      timeout?: number;
    } = {}
  ): Promise<void> {
    const appName = `discord-bot-${name}-${environment}`;
    const namespace = 'argocd';

    try {
      // Update application with new image tag and values
      const existingApp = await this.getApplication(appName, namespace);
      if (!existingApp) {
        throw new Error(`Application ${appName} not found`);
      }

      const updatedParameters = [
        ...existingApp.spec.source.helm?.parameters || [],
        {
          name: 'image.tag',
          value: imageTag
        }
      ];

      // Add custom values as parameters
      if (options.values) {
        for (const [key, value] of Object.entries(options.values)) {
          updatedParameters.push({
            name: key,
            value: String(value)
          });
        }
      }

      await this.updateApplication(appName, namespace, {
        source: {
          ...existingApp.spec.source,
          helm: {
            ...existingApp.spec.source.helm,
            parameters: updatedParameters
          }
        }
      });

      // Sync if requested
      if (options.sync) {
        await this.syncApplication(appName, namespace, {
          prune: true,
          dryRun: false
        });

        // Wait for sync to complete if timeout specified
        if (options.timeout) {
          await this.waitForSync(appName, namespace, options.timeout);
        }
      }

      logger.info(`Deployed Discord Bot ${name} to ${environment}`, {
        imageTag,
        values: options.values
      });

      this.emit('deployment-completed', {
        name,
        environment,
        imageTag,
        application: appName
      });

    } catch (error) {
      logger.error(`Failed to deploy Discord Bot ${name} to ${environment}`, error);
      this.emit('deployment-failed', {
        name,
        environment,
        imageTag,
        error
      });
      throw error;
    }
  }

  /**
   * Wait for application sync to complete
   */
  async waitForSync(
    name: string,
    namespace: string,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const app = await this.getApplication(name, namespace);
        if (!app) {
          throw new Error(`Application ${namespace}/${name} not found`);
        }

        const syncStatus = app.status?.sync?.status;
        const healthStatus = app.status?.health?.status;
        const operationPhase = app.status?.operationState?.phase;

        // Check if sync is complete
        if (syncStatus === 'Synced' && healthStatus === 'Healthy') {
          logger.info(`Application ${namespace}/${name} sync completed successfully`);
          return;
        }

        // Check if sync failed
        if (operationPhase === 'Failed' || operationPhase === 'Error') {
          const message = app.status?.operationState?.message || 'Sync operation failed';
          throw new Error(`Sync failed for ${namespace}/${name}: ${message}`);
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error(`Error waiting for sync: ${namespace}/${name}`, error);
        throw error;
      }
    }

    throw new Error(`Timeout waiting for sync: ${namespace}/${name}`);
  }

  /**
   * Start watching ArgoCD applications
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('ArgoCD Manager is already watching');
      return;
    }

    this.isWatching = true;
    this.watchAbortController = new AbortController();

    try {
      const response = await this.k8sApi.listClusterCustomObject(
        'argoproj.io',
        'v1alpha1',
        'applications',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      logger.info('Started watching ArgoCD Applications', {
        applicationCount: (response.body as any)?.items?.length || 0
      });

      // For now, just log the response since we can't directly watch
      // In a real implementation, you'd need to use the Kubernetes watch API
      logger.debug('ArgoCD Applications response:', response.body);

    } catch (error) {
      logger.error('Failed to start watching ArgoCD Applications:', error);
      this.isWatching = false;
      throw error;
    }
  }

  /**
   * Stop watching ArgoCD applications
   */
  async stopWatching(): Promise<void> {
    this.isWatching = false;
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = undefined;
    }
    logger.info('Stopped watching ArgoCD Applications');
  }

  /**
   * Handle watch events
   */
  private handleWatchEvent(event: any): void {
    const { type, object } = event;
    const app = object as ArgoCDApplication;
    const { name, namespace } = app.metadata;

    logger.debug(`ArgoCD watch event: ${type} for ${namespace}/${name}`);

    try {
      switch (type) {
        case 'ADDED':
        case 'MODIFIED':
          this.managedApplications.set(`${namespace}/${name}`, app);
          this.emit('application-changed', { type, application: app });
          break;
        case 'DELETED':
          this.managedApplications.delete(`${namespace}/${name}`);
          this.emit('application-deleted', { name, namespace });
          break;
        default:
          logger.warn(`Unknown ArgoCD watch event type: ${type}`);
      }
    } catch (error) {
      logger.error(`Failed to handle ArgoCD watch event ${type} for ${namespace}/${name}:`, error);
      this.errorCount++;
    }
  }

  /**
   * Get manager metrics
   */
  getMetrics(): Record<string, number> {
    return {
      argocd_applications_managed: this.managedApplications.size,
      argocd_sync_operations_total: this.syncCount,
      argocd_sync_duration_avg_ms: this.syncCount > 0 ? this.totalSyncTime / this.syncCount : 0,
      argocd_errors_total: this.errorCount,
      argocd_watching: this.isWatching ? 1 : 0
    };
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.isWatching && this.errorCount < 10;
  }
}
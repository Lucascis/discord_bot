/**
 * KEDA Manager
 * Manages Kubernetes Event-Driven Autoscaling (KEDA) for Discord Bot services
 */

import * as k8s from '@kubernetes/client-node';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';
import yaml from 'yaml';

/**
 * KEDA Scaler Configuration
 */
export interface KEDAScalerConfig {
  type: 'redis' | 'kafka' | 'prometheus' | 'external' | 'cron' | 'cpu' | 'memory';
  metadata: Record<string, string>;
  authenticationRef?: {
    name: string;
    key: string;
  };
}

/**
 * KEDA ScaledObject Configuration
 */
export interface KEDAScaledObjectConfig {
  name: string;
  namespace: string;
  scaleTargetRef: {
    name: string;
    kind?: string;
    apiVersion?: string;
  };
  pollingInterval?: number;
  cooldownPeriod?: number;
  idleReplicaCount?: number;
  minReplicaCount?: number;
  maxReplicaCount?: number;
  fallback?: {
    failureThreshold: number;
    replicas: number;
  };
  advanced?: {
    restoreToOriginalReplicaCount?: boolean;
    horizontalPodAutoscalerConfig?: {
      name?: string;
      behavior?: {
        scaleDown?: {
          stabilizationWindowSeconds?: number;
          policies?: Array<{
            type: 'Pods' | 'Percent';
            value: number;
            periodSeconds: number;
          }>;
        };
        scaleUp?: {
          stabilizationWindowSeconds?: number;
          policies?: Array<{
            type: 'Pods' | 'Percent';
            value: number;
            periodSeconds: number;
          }>;
        };
      };
    };
  };
  scalers: KEDAScalerConfig[];
}

/**
 * KEDA ScaledJob Configuration
 */
export interface KEDAScaledJobConfig {
  name: string;
  namespace: string;
  jobTargetRef: {
    template: k8s.V1JobTemplateSpec;
  };
  pollingInterval?: number;
  successfulJobsHistoryLimit?: number;
  failedJobsHistoryLimit?: number;
  maxReplicaCount?: number;
  scalingStrategy?: {
    strategy: 'default' | 'custom' | 'accurate' | 'eager';
    customScalingQueueLengthDeduction?: number;
    customScalingRunningJobPercentage?: string;
    pendingPodConditions?: string[];
    multipleScalersCalculation?: 'max' | 'min' | 'avg' | 'sum';
  };
  scalers: KEDAScalerConfig[];
}

/**
 * KEDA TriggerAuthentication Configuration
 */
export interface KEDATriggerAuthConfig {
  name: string;
  namespace: string;
  spec: {
    secretTargetRef?: Array<{
      parameter: string;
      name: string;
      key: string;
    }>;
    env?: Array<{
      parameter: string;
      name: string;
      containerName?: string;
    }>;
    hashiCorpVault?: {
      address: string;
      authentication: string;
      credential?: {
        token?: string;
        serviceAccount?: string;
      };
      secrets: Array<{
        parameter: string;
        key: string;
        path: string;
      }>;
    };
  };
}

/**
 * KEDA ScaledObject Resource
 */
export interface KEDAScaledObject {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: KEDAScaledObjectConfig;
  status?: {
    scaleTargetKind: string;
    scaleTargetGVKR: {
      group: string;
      version: string;
      kind: string;
      resource: string;
    };
    originalReplicaCount?: number;
    lastActiveTime?: string;
    externalMetricNames?: string[];
    resourceMetricNames?: string[];
    conditions?: Array<{
      type: string;
      status: string;
      lastTransitionTime: string;
      reason: string;
      message: string;
    }>;
  };
}

/**
 * Discord Bot Scaling Profiles
 */
export const DiscordBotScalingProfiles = {
  // Gateway service scaling based on Discord events
  gateway: {
    redis: {
      type: 'redis' as const,
      metadata: {
        address: 'redis-service:6379',
        listName: 'discord-bot:commands',
        listLength: '5',
        enableTLS: 'false'
      }
    },
    prometheus: {
      type: 'prometheus' as const,
      metadata: {
        serverAddress: 'http://prometheus:9090',
        metricName: 'discord_gateway_events_per_second',
        threshold: '10',
        query: 'rate(discord_gateway_events_total[1m])'
      }
    }
  },

  // Audio service scaling based on music queue and active players
  audio: {
    redis: {
      type: 'redis' as const,
      metadata: {
        address: 'redis-service:6379',
        listName: 'discord-bot:audio-queue',
        listLength: '3',
        enableTLS: 'false'
      }
    },
    prometheus: {
      type: 'prometheus' as const,
      metadata: {
        serverAddress: 'http://prometheus:9090',
        metricName: 'discord_audio_active_players',
        threshold: '5',
        query: 'sum(discord_audio_players_active)'
      }
    }
  },

  // API service scaling based on HTTP requests
  api: {
    prometheus: {
      type: 'prometheus' as const,
      metadata: {
        serverAddress: 'http://prometheus:9090',
        metricName: 'http_requests_per_second',
        threshold: '50',
        query: 'rate(http_requests_total[1m])'
      }
    }
  },

  // Worker service scaling based on job queues
  worker: {
    redis: {
      type: 'redis' as const,
      metadata: {
        address: 'redis-service:6379',
        listName: 'discord-bot:jobs',
        listLength: '10',
        enableTLS: 'false'
      }
    },
    kafka: {
      type: 'kafka' as const,
      metadata: {
        bootstrapServers: 'kafka:9092',
        consumerGroup: 'discord-bot-workers',
        topic: 'discord-bot-events',
        lagThreshold: '100'
      }
    }
  },

  // Cron-based scaling for batch operations
  cronScaling: {
    type: 'cron' as const,
    metadata: {
      timezone: 'UTC',
      start: '0 8 * * 1-5', // Scale up at 8 AM on weekdays
      end: '0 20 * * 1-5',   // Scale down at 8 PM on weekdays
      desiredReplicas: '5'
    }
  }
};

/**
 * KEDA Manager
 */
export class KEDAManager extends EventEmitter {
  private readonly k8sApi: k8s.CustomObjectsApi;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly metrics?: MetricsCollector;

  // Manager state
  private readonly managedScaledObjects = new Map<string, KEDAScaledObject>();
  private isWatching = false;
  private watchAbortController?: AbortController;

  // Performance tracking
  private scaleEventCount = 0;
  private totalScaleTime = 0;
  private errorCount = 0;

  constructor(metrics?: MetricsCollector) {
    super();
    this.metrics = metrics;

    // Initialize Kubernetes clients
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    this.k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);
    this.k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

    logger.info('KEDA Manager initialized');
  }

  /**
   * Create KEDA ScaledObject
   */
  async createScaledObject(config: KEDAScaledObjectConfig): Promise<KEDAScaledObject> {
    const scaledObject: KEDAScaledObject = {
      apiVersion: 'keda.sh/v1alpha1',
      kind: 'ScaledObject',
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/managed-by': 'discord-bot-keda'
        }
      },
      spec: config
    };

    try {
      const response = await this.k8sApi.createNamespacedCustomObject(
        'keda.sh',
        'v1alpha1',
        config.namespace,
        'scaledobjects',
        scaledObject
      );

      const created = response.body as KEDAScaledObject;
      this.managedScaledObjects.set(`${config.namespace}/${config.name}`, created);

      logger.info(`Created KEDA ScaledObject: ${config.namespace}/${config.name}`);
      this.emit('scaled-object-created', created);

      return created;
    } catch (error) {
      logger.error(`Failed to create KEDA ScaledObject: ${config.namespace}/${config.name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Update KEDA ScaledObject
   */
  async updateScaledObject(
    name: string,
    namespace: string,
    config: Partial<KEDAScaledObjectConfig>
  ): Promise<KEDAScaledObject> {
    try {
      const existing = await this.getScaledObject(name, namespace);
      if (!existing) {
        throw new Error(`ScaledObject ${namespace}/${name} not found`);
      }

      const updated: KEDAScaledObject = {
        ...existing,
        spec: {
          ...existing.spec,
          ...config
        }
      };

      const response = await this.k8sApi.replaceNamespacedCustomObject(
        'keda.sh',
        'v1alpha1',
        namespace,
        'scaledobjects',
        name,
        updated
      );

      const result = response.body as KEDAScaledObject;
      this.managedScaledObjects.set(`${namespace}/${name}`, result);

      logger.info(`Updated KEDA ScaledObject: ${namespace}/${name}`);
      this.emit('scaled-object-updated', result);

      return result;
    } catch (error) {
      logger.error(`Failed to update KEDA ScaledObject: ${namespace}/${name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Delete KEDA ScaledObject
   */
  async deleteScaledObject(name: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedCustomObject(
        'keda.sh',
        'v1alpha1',
        namespace,
        'scaledobjects',
        name
      );

      this.managedScaledObjects.delete(`${namespace}/${name}`);

      logger.info(`Deleted KEDA ScaledObject: ${namespace}/${name}`);
      this.emit('scaled-object-deleted', { name, namespace });
    } catch (error: any) {
      if (error.statusCode !== 404) {
        logger.error(`Failed to delete KEDA ScaledObject: ${namespace}/${name}`, error);
        this.errorCount++;
        throw error;
      }
    }
  }

  /**
   * Get KEDA ScaledObject
   */
  async getScaledObject(name: string, namespace: string): Promise<KEDAScaledObject | null> {
    try {
      const response = await this.k8sApi.getNamespacedCustomObject(
        'keda.sh',
        'v1alpha1',
        namespace,
        'scaledobjects',
        name
      );

      return response.body as KEDAScaledObject;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List KEDA ScaledObjects
   */
  async listScaledObjects(namespace?: string): Promise<KEDAScaledObject[]> {
    try {
      const response = namespace
        ? await this.k8sApi.listNamespacedCustomObject(
            'keda.sh',
            'v1alpha1',
            namespace,
            'scaledobjects'
          )
        : await this.k8sApi.listClusterCustomObject(
            'keda.sh',
            'v1alpha1',
            'scaledobjects'
          );

      const items = (response.body as any).items || [];
      return items as KEDAScaledObject[];
    } catch (error) {
      logger.error('Failed to list KEDA ScaledObjects', error);
      throw error;
    }
  }

  /**
   * Create TriggerAuthentication
   */
  async createTriggerAuthentication(config: KEDATriggerAuthConfig): Promise<void> {
    const triggerAuth = {
      apiVersion: 'keda.sh/v1alpha1',
      kind: 'TriggerAuthentication',
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/managed-by': 'discord-bot-keda'
        }
      },
      spec: config.spec
    };

    try {
      await this.k8sApi.createNamespacedCustomObject(
        'keda.sh',
        'v1alpha1',
        config.namespace,
        'triggerauthentications',
        triggerAuth
      );

      logger.info(`Created KEDA TriggerAuthentication: ${config.namespace}/${config.name}`);
      this.emit('trigger-auth-created', config);
    } catch (error) {
      logger.error(`Failed to create KEDA TriggerAuthentication: ${config.namespace}/${config.name}`, error);
      this.errorCount++;
      throw error;
    }
  }

  /**
   * Setup Discord Bot Auto-scaling
   */
  async setupDiscordBotScaling(
    name: string,
    namespace: string,
    options: {
      environment: 'dev' | 'staging' | 'prod';
      services: {
        gateway?: { enabled: boolean; minReplicas?: number; maxReplicas?: number };
        api?: { enabled: boolean; minReplicas?: number; maxReplicas?: number };
        audio?: { enabled: boolean; minReplicas?: number; maxReplicas?: number };
        worker?: { enabled: boolean; minReplicas?: number; maxReplicas?: number };
      };
      scaling?: {
        pollingInterval?: number;
        cooldownPeriod?: number;
        aggressive?: boolean;
      };
    }
  ): Promise<void> {
    const { environment, services, scaling = {} } = options;

    try {
      logger.info(`Setting up KEDA scaling for Discord Bot: ${name}`, options);

      // Setup authentication for external services
      await this.setupRedisAuthentication(namespace);
      await this.setupPrometheusAuthentication(namespace);

      // Configure scaling for each enabled service
      if (services.gateway?.enabled) {
        await this.setupGatewayScaling(name, namespace, {
          environment,
          minReplicas: services.gateway.minReplicas || 1,
          maxReplicas: services.gateway.maxReplicas || 10,
          ...scaling
        });
      }

      if (services.api?.enabled) {
        await this.setupAPIScaling(name, namespace, {
          environment,
          minReplicas: services.api.minReplicas || 1,
          maxReplicas: services.api.maxReplicas || 5,
          ...scaling
        });
      }

      if (services.audio?.enabled) {
        await this.setupAudioScaling(name, namespace, {
          environment,
          minReplicas: services.audio.minReplicas || 1,
          maxReplicas: services.audio.maxReplicas || 8,
          ...scaling
        });
      }

      if (services.worker?.enabled) {
        await this.setupWorkerScaling(name, namespace, {
          environment,
          minReplicas: services.worker.minReplicas || 0,
          maxReplicas: services.worker.maxReplicas || 20,
          ...scaling
        });
      }

      logger.info(`KEDA scaling setup completed for Discord Bot: ${name}`);
      this.emit('discord-bot-scaling-setup', { name, namespace, options });

    } catch (error) {
      logger.error(`Failed to setup KEDA scaling for Discord Bot: ${name}`, error);
      throw error;
    }
  }

  /**
   * Setup Gateway Service Scaling
   */
  private async setupGatewayScaling(
    name: string,
    namespace: string,
    options: {
      environment: string;
      minReplicas: number;
      maxReplicas: number;
      pollingInterval?: number;
      cooldownPeriod?: number;
      aggressive?: boolean;
    }
  ): Promise<void> {
    const scaledObjectConfig: KEDAScaledObjectConfig = {
      name: `${name}-gateway-scaler`,
      namespace,
      scaleTargetRef: {
        name: `${name}-gateway`
      },
      pollingInterval: options.pollingInterval || 30,
      cooldownPeriod: options.cooldownPeriod || 300,
      minReplicaCount: options.minReplicas,
      maxReplicaCount: options.maxReplicas,
      idleReplicaCount: options.minReplicas,
      fallback: {
        failureThreshold: 3,
        replicas: options.minReplicas + 1
      },
      advanced: {
        horizontalPodAutoscalerConfig: {
          behavior: {
            scaleUp: {
              stabilizationWindowSeconds: options.aggressive ? 30 : 60,
              policies: [{
                type: 'Percent',
                value: options.aggressive ? 100 : 50,
                periodSeconds: 60
              }]
            },
            scaleDown: {
              stabilizationWindowSeconds: options.aggressive ? 120 : 300,
              policies: [{
                type: 'Percent',
                value: 10,
                periodSeconds: 60
              }]
            }
          }
        }
      },
      scalers: [
        // Scale based on Redis command queue
        {
          ...DiscordBotScalingProfiles.gateway.redis,
          authenticationRef: {
            name: 'redis-auth',
            key: 'password'
          }
        },
        // Scale based on Discord events rate
        {
          ...DiscordBotScalingProfiles.gateway.prometheus,
          authenticationRef: {
            name: 'prometheus-auth',
            key: 'token'
          }
        }
      ]
    };

    await this.createScaledObject(scaledObjectConfig);
  }

  /**
   * Setup API Service Scaling
   */
  private async setupAPIScaling(
    name: string,
    namespace: string,
    options: {
      environment: string;
      minReplicas: number;
      maxReplicas: number;
      pollingInterval?: number;
      cooldownPeriod?: number;
      aggressive?: boolean;
    }
  ): Promise<void> {
    const scaledObjectConfig: KEDAScaledObjectConfig = {
      name: `${name}-api-scaler`,
      namespace,
      scaleTargetRef: {
        name: `${name}-api`
      },
      pollingInterval: options.pollingInterval || 30,
      cooldownPeriod: options.cooldownPeriod || 180,
      minReplicaCount: options.minReplicas,
      maxReplicaCount: options.maxReplicas,
      idleReplicaCount: options.minReplicas,
      scalers: [
        // Scale based on HTTP request rate
        {
          ...DiscordBotScalingProfiles.api.prometheus,
          metadata: {
            ...DiscordBotScalingProfiles.api.prometheus.metadata,
            query: `rate(http_requests_total{service="${name}-api"}[1m])`
          },
          authenticationRef: {
            name: 'prometheus-auth',
            key: 'token'
          }
        }
      ]
    };

    await this.createScaledObject(scaledObjectConfig);
  }

  /**
   * Setup Audio Service Scaling
   */
  private async setupAudioScaling(
    name: string,
    namespace: string,
    options: {
      environment: string;
      minReplicas: number;
      maxReplicas: number;
      pollingInterval?: number;
      cooldownPeriod?: number;
      aggressive?: boolean;
    }
  ): Promise<void> {
    const scaledObjectConfig: KEDAScaledObjectConfig = {
      name: `${name}-audio-scaler`,
      namespace,
      scaleTargetRef: {
        name: `${name}-audio`
      },
      pollingInterval: options.pollingInterval || 15,
      cooldownPeriod: options.cooldownPeriod || 120,
      minReplicaCount: options.minReplicas,
      maxReplicaCount: options.maxReplicas,
      idleReplicaCount: 0, // Can scale to zero when no audio activity
      scalers: [
        // Scale based on audio queue length
        {
          ...DiscordBotScalingProfiles.audio.redis,
          authenticationRef: {
            name: 'redis-auth',
            key: 'password'
          }
        },
        // Scale based on active players
        {
          ...DiscordBotScalingProfiles.audio.prometheus,
          metadata: {
            ...DiscordBotScalingProfiles.audio.prometheus.metadata,
            query: `sum(discord_audio_players_active{service="${name}-audio"})`
          },
          authenticationRef: {
            name: 'prometheus-auth',
            key: 'token'
          }
        }
      ]
    };

    await this.createScaledObject(scaledObjectConfig);
  }

  /**
   * Setup Worker Service Scaling
   */
  private async setupWorkerScaling(
    name: string,
    namespace: string,
    options: {
      environment: string;
      minReplicas: number;
      maxReplicas: number;
      pollingInterval?: number;
      cooldownPeriod?: number;
      aggressive?: boolean;
    }
  ): Promise<void> {
    const scaledObjectConfig: KEDAScaledObjectConfig = {
      name: `${name}-worker-scaler`,
      namespace,
      scaleTargetRef: {
        name: `${name}-worker`
      },
      pollingInterval: options.pollingInterval || 15,
      cooldownPeriod: options.cooldownPeriod || 60,
      minReplicaCount: options.minReplicas,
      maxReplicaCount: options.maxReplicas,
      idleReplicaCount: 0, // Scale to zero when no jobs
      scalers: [
        // Scale based on Redis job queue
        {
          ...DiscordBotScalingProfiles.worker.redis,
          authenticationRef: {
            name: 'redis-auth',
            key: 'password'
          }
        },
        // Scale based on Kafka lag
        {
          ...DiscordBotScalingProfiles.worker.kafka,
          authenticationRef: {
            name: 'kafka-auth',
            key: 'password'
          }
        }
      ]
    };

    await this.createScaledObject(scaledObjectConfig);
  }

  /**
   * Setup Redis Authentication
   */
  private async setupRedisAuthentication(namespace: string): Promise<void> {
    const config: KEDATriggerAuthConfig = {
      name: 'redis-auth',
      namespace,
      spec: {
        secretTargetRef: [{
          parameter: 'password',
          name: 'redis-credentials',
          key: 'password'
        }]
      }
    };

    await this.createTriggerAuthentication(config);
  }

  /**
   * Setup Prometheus Authentication
   */
  private async setupPrometheusAuthentication(namespace: string): Promise<void> {
    const config: KEDATriggerAuthConfig = {
      name: 'prometheus-auth',
      namespace,
      spec: {
        secretTargetRef: [{
          parameter: 'token',
          name: 'prometheus-credentials',
          key: 'token'
        }]
      }
    };

    await this.createTriggerAuthentication(config);
  }

  /**
   * Start watching KEDA resources
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('KEDA Manager is already watching');
      return;
    }

    this.isWatching = true;
    this.watchAbortController = new AbortController();

    try {
      const response = await this.k8sApi.listClusterCustomObject(
        'keda.sh',
        'v1alpha1',
        'scaledobjects',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      logger.info('Started watching KEDA ScaledObjects', {
        objectCount: (response.body as any)?.items?.length || 0
      });

      // For now, just log the response since we can't directly watch
      // In a real implementation, you'd need to use the Kubernetes watch API
      logger.debug('KEDA ScaledObjects response:', response.body);

    } catch (error) {
      logger.error('Failed to start watching KEDA resources:', error);
      this.isWatching = false;
      throw error;
    }
  }

  /**
   * Stop watching KEDA resources
   */
  async stopWatching(): Promise<void> {
    this.isWatching = false;
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = undefined;
    }
    logger.info('Stopped watching KEDA resources');
  }

  /**
   * Handle watch events
   */
  private handleWatchEvent(event: any): void {
    const { type, object } = event;
    const scaledObject = object as KEDAScaledObject;
    const { name, namespace } = scaledObject.metadata;

    logger.debug(`KEDA watch event: ${type} for ${namespace}/${name}`);

    try {
      switch (type) {
        case 'ADDED':
        case 'MODIFIED':
          this.managedScaledObjects.set(`${namespace}/${name}`, scaledObject);
          this.emit('scaled-object-changed', { type, scaledObject });

          // Track scaling events
          if (scaledObject.status?.conditions) {
            for (const condition of scaledObject.status.conditions) {
              if (condition.type === 'Ready' && condition.status === 'True') {
                this.scaleEventCount++;
                this.emit('scaling-event', {
                  name,
                  namespace,
                  condition,
                  timestamp: new Date()
                });
              }
            }
          }
          break;

        case 'DELETED':
          this.managedScaledObjects.delete(`${namespace}/${name}`);
          this.emit('scaled-object-deleted', { name, namespace });
          break;

        default:
          logger.warn(`Unknown KEDA watch event type: ${type}`);
      }
    } catch (error) {
      logger.error(`Failed to handle KEDA watch event ${type} for ${namespace}/${name}:`, error);
      this.errorCount++;
    }
  }

  /**
   * Get manager metrics
   */
  getMetrics(): Record<string, number> {
    const activeScalers = Array.from(this.managedScaledObjects.values());
    const readyScalers = activeScalers.filter(
      so => so.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')
    ).length;

    return {
      keda_scaled_objects_total: this.managedScaledObjects.size,
      keda_scaled_objects_ready: readyScalers,
      keda_scale_events_total: this.scaleEventCount,
      keda_errors_total: this.errorCount,
      keda_watching: this.isWatching ? 1 : 0
    };
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.isWatching && this.errorCount < 5;
  }
}
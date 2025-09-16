/**
 * Discord Bot Kubernetes Controller
 * Manages Discord Bot custom resources and associated Kubernetes resources
 */

import * as k8s from '@kubernetes/client-node';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';
import { ControllerHelpers } from './discord-bot-controller-helpers';

/**
 * Discord Bot Spec
 */
export interface DiscordBotSpec {
  botToken: string;
  applicationId: string;
  scaling: {
    enabled: boolean;
    minReplicas: number;
    maxReplicas: number;
    targetCPUUtilization: number;
    targetMemoryUtilization: number;
    customMetrics?: Array<{
      name: string;
      targetValue: string;
      selector?: {
        matchLabels: Record<string, string>;
      };
    }>;
  };
  services: {
    gateway: ServiceConfig;
    api: ServiceConfig;
    audio: AudioServiceConfig;
    worker: ServiceConfig;
  };
  database: DatabaseConfig;
  redis: RedisConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
}

export interface ServiceConfig {
  enabled: boolean;
  replicas: number;
  image: string;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
}

export interface AudioServiceConfig extends ServiceConfig {
  lavalink: {
    enabled: boolean;
    host: string;
    port: number;
    password: string;
  };
}

export interface DatabaseConfig {
  type: 'postgresql' | 'mysql';
  host: string;
  port: number;
  name: string;
  secretName: string;
  ssl: boolean;
  poolSize: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  secretName?: string;
  cluster: boolean;
  sentinel: boolean;
}

export interface MonitoringConfig {
  enabled: boolean;
  prometheus: {
    enabled: boolean;
    scrapeInterval: string;
  };
  grafana: {
    enabled: boolean;
    dashboards: boolean;
  };
  alerts: {
    enabled: boolean;
    slack?: {
      enabled: boolean;
      webhook: string;
    };
  };
}

export interface SecurityConfig {
  podSecurityContext: {
    runAsNonRoot: boolean;
    runAsUser: number;
    fsGroup: number;
  };
  networkPolicies: {
    enabled: boolean;
    ingress: Array<{
      from: Array<{
        namespaceSelector: {
          matchLabels: Record<string, string>;
        };
      }>;
      ports: Array<{
        protocol: string;
        port: number;
      }>;
    }>;
  };
}

/**
 * Discord Bot Status
 */
export interface DiscordBotStatus {
  phase: 'Pending' | 'Running' | 'Failed' | 'Succeeded';
  conditions: Array<{
    type: string;
    status: string;
    lastTransitionTime: string;
    reason: string;
    message: string;
  }>;
  services: {
    gateway: ServiceStatus;
    api: ServiceStatus;
    audio: ServiceStatus;
    worker: ServiceStatus;
  };
  observedGeneration: number;
  lastUpdateTime: string;
}

export interface ServiceStatus {
  ready: boolean;
  replicas: number;
  readyReplicas: number;
}

/**
 * Discord Bot Custom Resource
 */
export interface DiscordBotResource {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: DiscordBotSpec;
  status?: DiscordBotStatus;
}

/**
 * Discord Bot Controller
 */
export class DiscordBotController extends EventEmitter {
  private readonly k8sApi: k8s.CustomObjectsApi;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sAppsApi: k8s.AppsV1Api;
  private readonly k8sAutoScalingApi: k8s.AutoscalingV2Api;
  private readonly k8sNetworkingApi: k8s.NetworkingV1Api;
  private readonly metrics?: MetricsCollector;
  private readonly helpers: ControllerHelpers;

  // Controller state
  private readonly managedResources = new Map<string, DiscordBotResource>();
  private readonly resourceVersions = new Map<string, string>();
  private isWatching = false;
  private watchAbortController?: AbortController;

  // Performance tracking
  private reconciliationCount = 0;
  private totalReconciliationTime = 0;
  private errorCount = 0;

  constructor(metrics?: MetricsCollector) {
    super();
    this.metrics = metrics;

    // Initialize Kubernetes clients
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    this.k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);
    this.k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    this.k8sAutoScalingApi = kc.makeApiClient(k8s.AutoscalingV2Api);
    this.k8sNetworkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

    // Initialize helpers
    this.helpers = new ControllerHelpers(
      this.k8sCoreApi,
      this.k8sAppsApi,
      this.k8sAutoScalingApi,
      this.k8sNetworkingApi,
      this.k8sApi
    );

    logger.info('Discord Bot Controller initialized');
  }

  /**
   * Start watching for Discord Bot resources
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('Controller is already watching');
      return;
    }

    this.isWatching = true;
    this.watchAbortController = new AbortController();

    try {
      // Initial list of resources
      await this.syncResources();

      // Watch for changes
      const response = await this.k8sApi.listClusterCustomObject(
        'music.io',
        'v1alpha1',
        'discordbots',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      logger.info('Started watching Discord Bot resources', {
        resourceCount: (response.body as any)?.items?.length || 0
      });

      // For now, just log the response since we can't directly watch
      // In a real implementation, you'd need to use the Kubernetes watch API
      logger.debug('Discord Bot resources response:', response.body);

    } catch (error) {
      logger.error('Failed to start watching:', error);
      this.isWatching = false;
      throw error;
    }
  }

  /**
   * Stop watching for resources
   */
  async stopWatching(): Promise<void> {
    this.isWatching = false;
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = undefined;
    }
    logger.info('Stopped watching Discord Bot resources');
  }

  /**
   * Sync all existing resources
   */
  private async syncResources(): Promise<void> {
    try {
      const response = await this.k8sApi.listClusterCustomObject(
        'music.io',
        'v1alpha1',
        'discordbots'
      );

      const items = (response.body as any).items || [];
      for (const item of items) {
        await this.reconcile(item.metadata.name, item.metadata.namespace);
      }

      logger.info(`Synced ${items.length} Discord Bot resources`);
    } catch (error) {
      logger.error('Failed to sync resources:', error);
      throw error;
    }
  }

  /**
   * Handle watch events
   */
  private async handleWatchEvent(event: any): Promise<void> {
    const { type, object } = event;
    const { name, namespace } = object.metadata;

    logger.debug(`Watch event: ${type} for ${namespace}/${name}`);

    try {
      switch (type) {
        case 'ADDED':
        case 'MODIFIED':
          await this.reconcile(name, namespace);
          break;
        case 'DELETED':
          await this.helpers.cleanup(name, namespace);
          break;
        default:
          logger.warn(`Unknown watch event type: ${type}`);
      }
    } catch (error) {
      logger.error(`Failed to handle watch event ${type} for ${namespace}/${name}:`, error);
      this.errorCount++;
    }
  }

  /**
   * Main reconciliation logic
   */
  async reconcile(name: string, namespace: string): Promise<void> {
    const startTime = Date.now();
    this.reconciliationCount++;

    try {
      logger.info(`Reconciling Discord Bot ${namespace}/${name}`);

      // Get the Discord Bot resource
      const resource = await this.getDiscordBotResource(name, namespace);
      if (!resource) {
        logger.warn(`Discord Bot resource ${namespace}/${name} not found`);
        return;
      }

      // Update managed resources
      this.managedResources.set(`${namespace}/${name}`, resource);
      this.resourceVersions.set(`${namespace}/${name}`, resource.metadata.resourceVersion || '');

      // Reconcile all components
      await this.reconcileSecrets(resource);
      await this.reconcileServices(resource);
      await this.helpers.reconcileScaling(resource);
      await this.helpers.reconcileMonitoring(resource);
      await this.helpers.reconcileSecurity(resource);

      // Update status
      await this.helpers.updateStatus(resource);

      const duration = Date.now() - startTime;
      this.totalReconciliationTime += duration;

      logger.info(`Successfully reconciled ${namespace}/${name} in ${duration}ms`);
      this.emit('reconciled', { name, namespace, duration });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.errorCount++;
      logger.error(`Failed to reconcile ${namespace}/${name}:`, error);
      this.emit('reconciliation-error', { name, namespace, error, duration });
      throw error;
    }
  }

  /**
   * Get Discord Bot resource from Kubernetes
   */
  private async getDiscordBotResource(name: string, namespace: string): Promise<DiscordBotResource | null> {
    try {
      const response = await this.k8sApi.getNamespacedCustomObject(
        'music.io',
        'v1alpha1',
        namespace,
        'discordbots',
        name
      );
      return response.body as DiscordBotResource;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Reconcile secrets for the Discord Bot
   */
  private async reconcileSecrets(resource: DiscordBotResource): Promise<void> {
    const { name, namespace } = resource.metadata;
    const secretName = `${name}-secrets`;

    const secretManifest: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/managed-by': 'discord-bot-operator'
        },
        ownerReferences: [{
          apiVersion: resource.apiVersion,
          kind: resource.kind,
          name: name!,
          uid: resource.metadata.uid!,
          controller: true
        }]
      },
      type: 'Opaque',
      data: {
        'bot-token': Buffer.from(resource.spec.botToken).toString('base64'),
        'application-id': Buffer.from(resource.spec.applicationId).toString('base64')
      }
    };

    await this.helpers.applySecret(secretManifest);
  }

  /**
   * Reconcile all services (gateway, api, audio, worker)
   */
  private async reconcileServices(resource: DiscordBotResource): Promise<void> {
    const services = ['gateway', 'api', 'audio', 'worker'] as const;

    for (const serviceName of services) {
      const serviceConfig = resource.spec.services[serviceName];
      if (serviceConfig.enabled) {
        await this.reconcileService(resource, serviceName, serviceConfig);
      }
    }
  }

  /**
   * Reconcile individual service
   */
  private async reconcileService(
    resource: DiscordBotResource,
    serviceName: string,
    config: ServiceConfig | AudioServiceConfig
  ): Promise<void> {
    const { name, namespace } = resource.metadata;
    const fullServiceName = `${name}-${serviceName}`;

    // Create Deployment
    const deploymentManifest = this.createDeploymentManifest(
      resource, serviceName, config, fullServiceName
    );
    await this.helpers.applyDeployment(deploymentManifest);

    // Create Service
    const serviceManifest = this.createServiceManifest(
      resource, serviceName, config, fullServiceName
    );
    await this.helpers.applyService(serviceManifest);

    // Create ConfigMap if needed
    if (serviceName === 'audio' && 'lavalink' in config && config.lavalink.enabled) {
      const configMapManifest = this.createLavalinkConfigMap(resource, config);
      await this.helpers.applyConfigMap(configMapManifest);
    }
  }

  /**
   * Create deployment manifest
   */
  private createDeploymentManifest(
    resource: DiscordBotResource,
    serviceName: string,
    config: ServiceConfig | AudioServiceConfig,
    fullServiceName: string
  ): k8s.V1Deployment {
    const { name, namespace } = resource.metadata;
    const labels = {
      'app.kubernetes.io/name': 'discord-bot',
      'app.kubernetes.io/instance': name!,
      'app.kubernetes.io/component': serviceName,
      'app.kubernetes.io/managed-by': 'discord-bot-operator'
    };

    const env: k8s.V1EnvVar[] = [
      {
        name: 'NODE_ENV',
        value: 'production'
      },
      {
        name: 'BOT_TOKEN',
        valueFrom: {
          secretKeyRef: {
            name: `${name}-secrets`,
            key: 'bot-token'
          }
        }
      },
      {
        name: 'APPLICATION_ID',
        valueFrom: {
          secretKeyRef: {
            name: `${name}-secrets`,
            key: 'application-id'
          }
        }
      },
      {
        name: 'DATABASE_URL',
        value: `postgresql://${resource.spec.database.host}:${resource.spec.database.port}/${resource.spec.database.name}`
      },
      {
        name: 'REDIS_URL',
        value: `redis://${resource.spec.redis.host}:${resource.spec.redis.port}`
      }
    ];

    // Add service-specific environment variables
    if (serviceName === 'audio' && 'lavalink' in config && config.lavalink.enabled) {
      env.push(
        {
          name: 'LAVALINK_HOST',
          value: config.lavalink.host
        },
        {
          name: 'LAVALINK_PORT',
          value: config.lavalink.port.toString()
        },
        {
          name: 'LAVALINK_PASSWORD',
          value: config.lavalink.password
        }
      );
    }

    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: fullServiceName,
        namespace,
        labels,
        ownerReferences: [{
          apiVersion: resource.apiVersion,
          kind: resource.kind,
          name: name!,
          uid: resource.metadata.uid!,
          controller: true
        }]
      },
      spec: {
        replicas: config.replicas,
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'discord-bot',
            'app.kubernetes.io/instance': name!,
            'app.kubernetes.io/component': serviceName
          }
        },
        template: {
          metadata: {
            labels,
            annotations: {
              'prometheus.io/scrape': 'true',
              'prometheus.io/port': '3000',
              'prometheus.io/path': '/metrics'
            }
          },
          spec: {
            securityContext: resource.spec.security.podSecurityContext,
            containers: [{
              name: serviceName,
              image: config.image,
              ports: [
                {
                  name: 'http',
                  containerPort: serviceName === 'api' ? 3000 : 8080,
                  protocol: 'TCP'
                },
                {
                  name: 'metrics',
                  containerPort: 3000,
                  protocol: 'TCP'
                }
              ],
              env,
              resources: config.resources,
              livenessProbe: {
                httpGet: {
                  path: '/health',
                  port: serviceName === 'api' ? 3000 : 8080
                },
                initialDelaySeconds: 30,
                periodSeconds: 10
              },
              readinessProbe: {
                httpGet: {
                  path: '/ready',
                  port: serviceName === 'api' ? 3000 : 8080
                },
                initialDelaySeconds: 5,
                periodSeconds: 5
              }
            }]
          }
        }
      }
    };
  }

  /**
   * Create service manifest
   */
  private createServiceManifest(
    resource: DiscordBotResource,
    serviceName: string,
    config: ServiceConfig | AudioServiceConfig,
    fullServiceName: string
  ): k8s.V1Service {
    const { name, namespace } = resource.metadata;
    const labels = {
      'app.kubernetes.io/name': 'discord-bot',
      'app.kubernetes.io/instance': name!,
      'app.kubernetes.io/component': serviceName,
      'app.kubernetes.io/managed-by': 'discord-bot-operator'
    };

    return {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: fullServiceName,
        namespace,
        labels,
        ownerReferences: [{
          apiVersion: resource.apiVersion,
          kind: resource.kind,
          name: name!,
          uid: resource.metadata.uid!,
          controller: true
        }]
      },
      spec: {
        selector: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/component': serviceName
        },
        ports: [
          {
            name: 'http',
            port: serviceName === 'api' ? 3000 : 8080,
            targetPort: serviceName === 'api' ? 3000 : 8080,
            protocol: 'TCP'
          },
          {
            name: 'metrics',
            port: 3001,
            targetPort: 3000,
            protocol: 'TCP'
          }
        ],
        type: 'ClusterIP'
      }
    };
  }

  /**
   * Create Lavalink ConfigMap
   */
  private createLavalinkConfigMap(
    resource: DiscordBotResource,
    config: AudioServiceConfig
  ): k8s.V1ConfigMap {
    const { name, namespace } = resource.metadata;

    const lavalinkConfig = `
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  server:
    password: "${config.lavalink.password}"
    sources:
      youtube: true
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: true
      http: true
      local: false
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    trackStuckThresholdMs: 10000
    youtubePlaylistLoadLimit: 6
    playerUpdateInterval: 5
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
    gc-warnings: true

metrics:
  prometheus:
    enabled: true
    endpoint: /metrics

logging:
  file:
    max-history: 30
    max-size: 1GB
  path: ./logs/
  level:
    root: INFO
    lavalink: INFO

plugins:
  - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:4.8.1"
  - dependency: "com.github.topi314.lavasearch:lavasearch-plugin:1.0.0"
  - dependency: "com.github.topi314.sponsorblock:sponsorblock-plugin:3.0.1"
    `;

    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: `${name}-lavalink-config`,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/component': 'lavalink',
          'app.kubernetes.io/managed-by': 'discord-bot-operator'
        },
        ownerReferences: [{
          apiVersion: resource.apiVersion,
          kind: resource.kind,
          name: name!,
          uid: resource.metadata.uid!,
          controller: true
        }]
      },
      data: {
        'application.yml': lavalinkConfig
      }
    };
  }

  /**
   * Start the controller
   */
  async start(): Promise<void> {
    logger.info('Starting Discord Bot Controller');

    try {
      // Start watching for resources
      await this.startWatching();
      logger.info('Discord Bot Controller started successfully');
    } catch (error) {
      logger.error('Failed to start Discord Bot Controller:', error);
      throw error;
    }
  }

  /**
   * Stop the controller
   */
  async stop(): Promise<void> {
    logger.info('Stopping Discord Bot Controller');
    await this.stopWatching();
    logger.info('Discord Bot Controller stopped');
  }

  /**
   * Get controller metrics
   */
  getMetrics(): Record<string, number> {
    return {
      reconciliations_total: this.reconciliationCount,
      reconciliation_duration_seconds: this.totalReconciliationTime / 1000,
      errors_total: this.errorCount,
      managed_resources: this.managedResources.size
    };
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.isWatching && this.errorCount < 10;
  }
}
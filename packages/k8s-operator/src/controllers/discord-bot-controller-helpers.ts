/**
 * Discord Bot Controller Helper Functions
 * Additional methods for managing Kubernetes resources
 */

import * as k8s from '@kubernetes/client-node';
import { logger } from '@discord-bot/logger';
import { DiscordBotResource, DiscordBotStatus, ServiceStatus } from './discord-bot-controller';

/**
 * Controller Helper Methods
 */
export class ControllerHelpers {
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sAppsApi: k8s.AppsV1Api;
  private readonly k8sAutoScalingApi: k8s.AutoscalingV2Api;
  private readonly k8sNetworkingApi: k8s.NetworkingV1Api;
  private readonly k8sApi: k8s.CustomObjectsApi;

  constructor(
    k8sCoreApi: k8s.CoreV1Api,
    k8sAppsApi: k8s.AppsV1Api,
    k8sAutoScalingApi: k8s.AutoscalingV2Api,
    k8sNetworkingApi: k8s.NetworkingV1Api,
    k8sApi: k8s.CustomObjectsApi
  ) {
    this.k8sCoreApi = k8sCoreApi;
    this.k8sAppsApi = k8sAppsApi;
    this.k8sAutoScalingApi = k8sAutoScalingApi;
    this.k8sNetworkingApi = k8sNetworkingApi;
    this.k8sApi = k8sApi;
  }

  /**
   * Apply Secret to Kubernetes
   */
  async applySecret(manifest: k8s.V1Secret): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing secret
      await this.k8sCoreApi.readNamespacedSecret(name!, namespace!);

      // Update existing secret
      await this.k8sCoreApi.replaceNamespacedSecret(name!, namespace!, manifest);
      logger.debug(`Updated Secret ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new secret
        await this.k8sCoreApi.createNamespacedSecret(namespace!, manifest);
        logger.debug(`Created Secret ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Apply Deployment to Kubernetes
   */
  async applyDeployment(manifest: k8s.V1Deployment): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing deployment
      await this.k8sAppsApi.readNamespacedDeployment(name!, namespace!);

      // Update existing deployment
      await this.k8sAppsApi.replaceNamespacedDeployment(name!, namespace!, manifest);
      logger.debug(`Updated Deployment ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new deployment
        await this.k8sAppsApi.createNamespacedDeployment(namespace!, manifest);
        logger.debug(`Created Deployment ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Apply Service to Kubernetes
   */
  async applyService(manifest: k8s.V1Service): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing service
      const existing = await this.k8sCoreApi.readNamespacedService(name!, namespace!);

      // Preserve ClusterIP for existing services
      if (existing.body.spec?.clusterIP && existing.body.spec.clusterIP !== 'None') {
        manifest.spec!.clusterIP = existing.body.spec.clusterIP;
      }

      // Update existing service
      await this.k8sCoreApi.replaceNamespacedService(name!, namespace!, manifest);
      logger.debug(`Updated Service ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new service
        await this.k8sCoreApi.createNamespacedService(namespace!, manifest);
        logger.debug(`Created Service ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Apply ConfigMap to Kubernetes
   */
  async applyConfigMap(manifest: k8s.V1ConfigMap): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing configmap
      await this.k8sCoreApi.readNamespacedConfigMap(name!, namespace!);

      // Update existing configmap
      await this.k8sCoreApi.replaceNamespacedConfigMap(name!, namespace!, manifest);
      logger.debug(`Updated ConfigMap ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new configmap
        await this.k8sCoreApi.createNamespacedConfigMap(namespace!, manifest);
        logger.debug(`Created ConfigMap ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Apply HorizontalPodAutoscaler to Kubernetes
   */
  async applyHPA(manifest: k8s.V2HorizontalPodAutoscaler): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing HPA
      await this.k8sAutoScalingApi.readNamespacedHorizontalPodAutoscaler(name!, namespace!);

      // Update existing HPA
      await this.k8sAutoScalingApi.replaceNamespacedHorizontalPodAutoscaler(name!, namespace!, manifest);
      logger.debug(`Updated HPA ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new HPA
        await this.k8sAutoScalingApi.createNamespacedHorizontalPodAutoscaler(namespace!, manifest);
        logger.debug(`Created HPA ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Apply NetworkPolicy to Kubernetes
   */
  async applyNetworkPolicy(manifest: k8s.V1NetworkPolicy): Promise<void> {
    const { name, namespace } = manifest.metadata!;

    try {
      // Try to get existing network policy
      await this.k8sNetworkingApi.readNamespacedNetworkPolicy(name!, namespace!);

      // Update existing network policy
      await this.k8sNetworkingApi.replaceNamespacedNetworkPolicy(name!, namespace!, manifest);
      logger.debug(`Updated NetworkPolicy ${namespace}/${name}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Create new network policy
        await this.k8sNetworkingApi.createNamespacedNetworkPolicy(namespace!, manifest);
        logger.debug(`Created NetworkPolicy ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Reconcile Horizontal Pod Autoscaler
   */
  async reconcileScaling(resource: DiscordBotResource): Promise<void> {
    if (!resource.spec.scaling.enabled) {
      logger.debug('Scaling is disabled, skipping HPA creation');
      return;
    }

    const { name, namespace } = resource.metadata;
    const services = ['gateway', 'api', 'audio', 'worker'] as const;

    for (const serviceName of services) {
      const serviceConfig = resource.spec.services[serviceName];
      if (!serviceConfig.enabled) continue;

      const hpaName = `${name}-${serviceName}-hpa`;
      const targetName = `${name}-${serviceName}`;

      const metrics: k8s.V2MetricSpec[] = [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: {
              type: 'Utilization',
              averageUtilization: resource.spec.scaling.targetCPUUtilization
            }
          }
        },
        {
          type: 'Resource',
          resource: {
            name: 'memory',
            target: {
              type: 'Utilization',
              averageUtilization: resource.spec.scaling.targetMemoryUtilization
            }
          }
        }
      ];

      // Add custom metrics
      if (resource.spec.scaling.customMetrics) {
        for (const customMetric of resource.spec.scaling.customMetrics) {
          metrics.push({
            type: 'Object',
            object: {
              metric: {
                name: customMetric.name,
                selector: customMetric.selector
              },
              target: {
                type: 'Value',
                value: customMetric.targetValue
              },
              describedObject: {
                apiVersion: 'v1',
                kind: 'Pod',
                name: 'discord-bot'
              }
            }
          });
        }
      }

      const hpaManifest: k8s.V2HorizontalPodAutoscaler = {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: {
          name: hpaName,
          namespace,
          labels: {
            'app.kubernetes.io/name': 'discord-bot',
            'app.kubernetes.io/instance': name!,
            'app.kubernetes.io/component': `${serviceName}-hpa`,
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
        spec: {
          scaleTargetRef: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            name: targetName
          },
          minReplicas: resource.spec.scaling.minReplicas,
          maxReplicas: resource.spec.scaling.maxReplicas,
          metrics,
          behavior: {
            scaleUp: {
              stabilizationWindowSeconds: 60,
              policies: [{
                type: 'Percent',
                value: 100,
                periodSeconds: 15
              }]
            },
            scaleDown: {
              stabilizationWindowSeconds: 300,
              policies: [{
                type: 'Percent',
                value: 10,
                periodSeconds: 60
              }]
            }
          }
        }
      };

      await this.applyHPA(hpaManifest);
    }
  }

  /**
   * Reconcile monitoring resources
   */
  async reconcileMonitoring(resource: DiscordBotResource): Promise<void> {
    if (!resource.spec.monitoring.enabled) {
      logger.debug('Monitoring is disabled, skipping monitoring setup');
      return;
    }

    await this.createServiceMonitor(resource);

    if (resource.spec.monitoring.prometheus.enabled) {
      await this.createPrometheusRule(resource);
    }
  }

  /**
   * Create ServiceMonitor for Prometheus
   */
  private async createServiceMonitor(resource: DiscordBotResource): Promise<void> {
    const { name, namespace } = resource.metadata;

    const serviceMonitor = {
      apiVersion: 'monitoring.coreos.com/v1',
      kind: 'ServiceMonitor',
      metadata: {
        name: `${name}-metrics`,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/component': 'monitoring',
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
      spec: {
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'discord-bot',
            'app.kubernetes.io/instance': name!
          }
        },
        endpoints: [{
          port: 'metrics',
          interval: resource.spec.monitoring.prometheus.scrapeInterval,
          path: '/metrics'
        }]
      }
    };

    // Apply as custom resource
    try {
      await this.k8sApi.getNamespacedCustomObject(
        'monitoring.coreos.com',
        'v1',
        namespace!,
        'servicemonitors',
        `${name}-metrics`
      );

      await this.k8sApi.replaceNamespacedCustomObject(
        'monitoring.coreos.com',
        'v1',
        namespace!,
        'servicemonitors',
        `${name}-metrics`,
        serviceMonitor
      );
      logger.debug(`Updated ServiceMonitor ${namespace}/${name}-metrics`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        await this.k8sApi.createNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          namespace!,
          'servicemonitors',
          serviceMonitor
        );
        logger.debug(`Created ServiceMonitor ${namespace}/${name}-metrics`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create PrometheusRule for alerting
   */
  private async createPrometheusRule(resource: DiscordBotResource): Promise<void> {
    const { name, namespace } = resource.metadata;

    const prometheusRule = {
      apiVersion: 'monitoring.coreos.com/v1',
      kind: 'PrometheusRule',
      metadata: {
        name: `${name}-alerts`,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/component': 'alerting',
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
      spec: {
        groups: [{
          name: `discord-bot-${name}`,
          rules: [
            {
              alert: 'DiscordBotDown',
              expr: `up{job="discord-bot-${name}"} == 0`,
              for: '5m',
              labels: {
                severity: 'critical',
                service: 'discord-bot'
              },
              annotations: {
                summary: `Discord Bot ${name} is down`,
                description: `Discord Bot instance ${name} has been down for more than 5 minutes.`
              }
            },
            {
              alert: 'DiscordBotHighMemoryUsage',
              expr: `(process_resident_memory_bytes{job="discord-bot-${name}"} / 1024 / 1024) > 512`,
              for: '10m',
              labels: {
                severity: 'warning',
                service: 'discord-bot'
              },
              annotations: {
                summary: `Discord Bot ${name} high memory usage`,
                description: `Discord Bot instance ${name} is using more than 512MB of memory.`
              }
            },
            {
              alert: 'DiscordBotHighCPUUsage',
              expr: `rate(process_cpu_seconds_total{job="discord-bot-${name}"}[5m]) * 100 > 80`,
              for: '10m',
              labels: {
                severity: 'warning',
                service: 'discord-bot'
              },
              annotations: {
                summary: `Discord Bot ${name} high CPU usage`,
                description: `Discord Bot instance ${name} is using more than 80% CPU for 10 minutes.`
              }
            }
          ]
        }]
      }
    };

    // Apply as custom resource
    try {
      await this.k8sApi.getNamespacedCustomObject(
        'monitoring.coreos.com',
        'v1',
        namespace!,
        'prometheusrules',
        `${name}-alerts`
      );

      await this.k8sApi.replaceNamespacedCustomObject(
        'monitoring.coreos.com',
        'v1',
        namespace!,
        'prometheusrules',
        `${name}-alerts`,
        prometheusRule
      );
      logger.debug(`Updated PrometheusRule ${namespace}/${name}-alerts`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        await this.k8sApi.createNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          namespace!,
          'prometheusrules',
          prometheusRule
        );
        logger.debug(`Created PrometheusRule ${namespace}/${name}-alerts`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Reconcile security policies
   */
  async reconcileSecurity(resource: DiscordBotResource): Promise<void> {
    if (resource.spec.security.networkPolicies.enabled) {
      await this.createNetworkPolicies(resource);
    }
  }

  /**
   * Create NetworkPolicy for security
   */
  private async createNetworkPolicies(resource: DiscordBotResource): Promise<void> {
    const { name, namespace } = resource.metadata;

    const networkPolicy: k8s.V1NetworkPolicy = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: `${name}-network-policy`,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'discord-bot',
          'app.kubernetes.io/instance': name!,
          'app.kubernetes.io/component': 'security',
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
      spec: {
        podSelector: {
          matchLabels: {
            'app.kubernetes.io/name': 'discord-bot',
            'app.kubernetes.io/instance': name!
          }
        },
        policyTypes: ['Ingress', 'Egress'],
        ingress: resource.spec.security.networkPolicies.ingress,
        egress: [
          {
            // Allow DNS
            ports: [{
              protocol: 'UDP',
              port: 53
            }]
          },
          {
            // Allow HTTPS (Discord API, external services)
            ports: [{
              protocol: 'TCP',
              port: 443
            }]
          },
          {
            // Allow Database access
            ports: [{
              protocol: 'TCP',
              port: resource.spec.database.port
            }],
            to: [{
              namespaceSelector: {},
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/name': 'postgresql'
                }
              }
            }]
          },
          {
            // Allow Redis access
            ports: [{
              protocol: 'TCP',
              port: resource.spec.redis.port
            }],
            to: [{
              namespaceSelector: {},
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/name': 'redis'
                }
              }
            }]
          }
        ]
      }
    };

    await this.applyNetworkPolicy(networkPolicy);
  }

  /**
   * Update Discord Bot resource status
   */
  async updateStatus(resource: DiscordBotResource): Promise<void> {
    const { name, namespace } = resource.metadata;

    try {
      const status = await this.collectStatus(resource);

      const statusPatch = {
        status: {
          ...status,
          observedGeneration: resource.metadata.generation,
          lastUpdateTime: new Date().toISOString()
        }
      };

      await this.k8sApi.patchNamespacedCustomObjectStatus(
        'music.io',
        'v1alpha1',
        namespace!,
        'discordbots',
        name!,
        statusPatch
      );

      logger.debug(`Updated status for ${namespace}/${name}`);
    } catch (error) {
      logger.error(`Failed to update status for ${namespace}/${name}:`, error);
    }
  }

  /**
   * Collect current status from Kubernetes resources
   */
  private async collectStatus(resource: DiscordBotResource): Promise<DiscordBotStatus> {
    const { name, namespace } = resource.metadata;
    const services = ['gateway', 'api', 'audio', 'worker'] as const;

    const serviceStatuses: Record<string, ServiceStatus> = {};
    let allReady = true;
    let hasError = false;

    for (const serviceName of services) {
      if (!resource.spec.services[serviceName].enabled) {
        serviceStatuses[serviceName] = {
          ready: false,
          replicas: 0,
          readyReplicas: 0
        };
        continue;
      }

      try {
        const deploymentName = `${name}-${serviceName}`;
        const deployment = await this.k8sAppsApi.readNamespacedDeployment(deploymentName, namespace!);

        const replicas = deployment.body.status?.replicas || 0;
        const readyReplicas = deployment.body.status?.readyReplicas || 0;
        const ready = readyReplicas === replicas && replicas > 0;

        serviceStatuses[serviceName] = {
          ready,
          replicas,
          readyReplicas
        };

        if (!ready) allReady = false;
      } catch (error) {
        serviceStatuses[serviceName] = {
          ready: false,
          replicas: 0,
          readyReplicas: 0
        };
        allReady = false;
        hasError = true;
      }
    }

    const phase: DiscordBotStatus['phase'] = hasError ? 'Failed' :
                                            allReady ? 'Running' : 'Pending';

    const conditions = [{
      type: 'Ready',
      status: allReady ? 'True' : 'False',
      lastTransitionTime: new Date().toISOString(),
      reason: allReady ? 'AllServicesReady' : 'ServicesNotReady',
      message: allReady ? 'All services are ready' : 'Some services are not ready'
    }];

    return {
      phase,
      conditions,
      services: serviceStatuses as DiscordBotStatus['services'],
      observedGeneration: 0,
      lastUpdateTime: ''
    };
  }

  /**
   * Cleanup resources when Discord Bot is deleted
   */
  async cleanup(name: string, namespace: string): Promise<void> {
    logger.info(`Cleaning up Discord Bot ${namespace}/${name}`);

    // Resources will be automatically deleted by Kubernetes
    // due to owner references, but we can do additional cleanup here

    try {
      // Clean up any external resources not managed by Kubernetes
      logger.debug(`Cleaned up external resources for ${namespace}/${name}`);
    } catch (error) {
      logger.error(`Failed to cleanup external resources for ${namespace}/${name}:`, error);
    }
  }

  /**
   * Get controller metrics
   */
  getMetrics(): Record<string, number> {
    return {
      reconciliations_total: 0,
      reconciliation_duration_seconds: 0,
      errors_total: 0,
      managed_resources: 0
    };
  }
}
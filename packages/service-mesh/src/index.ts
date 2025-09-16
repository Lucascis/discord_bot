/**
 * Service Mesh Package Entry Point
 * Istio-based service mesh implementation with advanced features
 */

import { logger } from '@discord-bot/logger';

// Core Istio Management
export {
  IstioManager,
  type ServiceMeshConfig,
  type ServiceDefinition,
  type TrafficPolicy,
  type SecurityPolicy
} from './istio/istio-manager.js';

// Intelligent Traffic Management
export {
  IntelligentTrafficRouter,
  type TrafficMetrics,
  type ServiceHealth,
  type RoutingDecision,
  type RoutingRule,
  type CircuitBreakerState
} from './traffic-management/intelligent-routing.js';

// Mutual TLS Security
export {
  MTLSManager,
  type CAConfig,
  type CertificateRequest,
  type CertificateInfo,
  type TLSPolicy,
  type CertificateMetrics
} from './security/mtls-manager.js';

// Observability and Telemetry
export {
  MeshTelemetryManager,
  type ServiceMeshMetrics,
  type DistributedTrace,
  type ServiceHealthCheck,
  type SLIDefinition,
  type SLO
} from './observability/mesh-telemetry.js';

/**
 * Complete Service Mesh System
 * Integrates all service mesh components for comprehensive microservices management
 */
export class ServiceMeshSystem {
  private readonly istioManager: IstioManager;
  private readonly trafficRouter: IntelligentTrafficRouter;
  private readonly mtlsManager: MTLSManager;
  private readonly telemetryManager: MeshTelemetryManager;

  constructor(config: {
    serviceMesh: ServiceMeshConfig;
    ca: CAConfig;
    metrics?: any;
  }) {
    // Initialize components
    this.istioManager = new IstioManager(config.serviceMesh, config.metrics);
    this.trafficRouter = new IntelligentTrafficRouter(config.metrics);
    this.mtlsManager = new MTLSManager(config.ca, config.metrics);
    this.telemetryManager = new MeshTelemetryManager(config.metrics);

    // Wire up component interactions
    this.setupComponentIntegration();

    logger.info('Service Mesh System initialized');
  }

  /**
   * Get Istio manager
   */
  getIstioManager(): IstioManager {
    return this.istioManager;
  }

  /**
   * Get traffic router
   */
  getTrafficRouter(): IntelligentTrafficRouter {
    return this.trafficRouter;
  }

  /**
   * Get mTLS manager
   */
  getMTLSManager(): MTLSManager {
    return this.mtlsManager;
  }

  /**
   * Get telemetry manager
   */
  getTelemetryManager(): MeshTelemetryManager {
    return this.telemetryManager;
  }

  /**
   * Deploy service to mesh
   */
  async deployService(service: {
    definition: ServiceDefinition;
    trafficPolicy?: TrafficPolicy;
    securityPolicy?: SecurityPolicy;
    healthCheck?: ServiceHealthCheck;
    slo?: SLO;
  }): Promise<void> {
    logger.info('Deploying service to mesh', {
      service: service.definition.name,
      version: service.definition.version,
      namespace: service.definition.namespace
    });

    try {
      // 1. Register service with Istio
      await this.istioManager.registerService(service.definition);

      // 2. Issue mTLS certificate
      const certRequest: CertificateRequest = {
        serviceName: service.definition.name,
        namespace: service.definition.namespace,
        commonName: service.definition.name,
        subjectAlternativeNames: [
          service.definition.name,
          `${service.definition.name}.${service.definition.namespace}.svc.cluster.local`
        ],
        keyUsage: ['digitalSignature', 'keyEncipherment'],
        extendedKeyUsage: ['serverAuth', 'clientAuth'],
        validityDays: 90
      };

      const certificates = await this.mtlsManager.issueCertificate(certRequest);

      // 3. Apply traffic policy
      if (service.trafficPolicy) {
        await this.istioManager.applyTrafficPolicy(service.definition.name, service.trafficPolicy);
      }

      // 4. Configure security policy
      if (service.securityPolicy) {
        await this.istioManager.configureSecurityPolicy(service.securityPolicy);
      }

      // 5. Register health check
      if (service.healthCheck) {
        this.telemetryManager.registerHealthCheck(service.healthCheck);
      }

      // 6. Create SLO
      if (service.slo) {
        this.telemetryManager.createSLO(service.slo);
      }

      logger.info('Service deployed to mesh successfully', {
        service: service.definition.name,
        certificateIssued: true,
        trafficPolicyApplied: !!service.trafficPolicy,
        securityPolicyConfigured: !!service.securityPolicy
      });

    } catch (error) {
      logger.error('Failed to deploy service to mesh', {
        service: service.definition.name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Perform intelligent routing decision
   */
  async routeRequest(request: {
    serviceName: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    userContext?: {
      userId: string;
      geoLocation: string;
      userAgent: string;
    };
  }): Promise<{
    decision: RoutingDecision;
    traceId: string;
  }> {
    // Start distributed trace
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const spanId = this.telemetryManager.startTrace({
      traceId,
      operationName: `${request.method} ${request.path}`,
      serviceName: request.serviceName,
      tags: {
        'http.method': request.method,
        'http.url': request.path,
        'user.id': request.userContext?.userId || 'anonymous'
      },
      logs: [],
      meshData: {
        sourceService: 'gateway',
        sourceVersion: 'v1',
        destinationService: request.serviceName,
        destinationVersion: 'unknown',
        protocol: 'HTTP',
        method: request.method,
        url: request.path,
        requestId: traceId
      }
    });

    try {
      // Make routing decision
      const decision = await this.trafficRouter.makeRoutingDecision(request);

      // Update trace with routing decision
      this.telemetryManager.addTraceLog(spanId, {
        level: 'info',
        message: 'Routing decision made',
        fields: {
          targetService: decision.targetService,
          targetVersion: decision.targetVersion,
          algorithm: decision.metadata.algorithm,
          confidence: decision.confidence
        }
      });

      // Finish trace
      this.telemetryManager.finishTrace(spanId, {
        tags: {
          ...request.headers,
          'routing.target_version': decision.targetVersion,
          'routing.algorithm': decision.metadata.algorithm
        },
        meshData: {
          sourceService: 'gateway',
          sourceVersion: 'v1',
          destinationService: decision.targetService,
          destinationVersion: decision.targetVersion,
          protocol: 'HTTP',
          method: request.method,
          url: request.path,
          requestId: traceId
        }
      });

      return { decision, traceId };

    } catch (error) {
      // Log error in trace
      this.telemetryManager.addTraceLog(spanId, {
        level: 'error',
        message: 'Routing decision failed',
        fields: {
          error: error instanceof Error ? error.message : String(error)
        }
      });

      this.telemetryManager.finishTrace(spanId);
      throw error;
    }
  }

  /**
   * Get comprehensive mesh status
   */
  getMeshStatus(): {
    istio: any;
    trafficRouting: any;
    security: CertificateMetrics;
    telemetry: any;
    overall: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      issues: string[];
      services: number;
      certificatesValid: number;
      slosViolated: number;
    };
  } {
    const istioMetrics = this.istioManager.getMetrics();
    const routingMetrics = this.trafficRouter.getRoutingMetrics();
    const certificateMetrics = this.mtlsManager.getCertificateMetrics();
    const telemetryDashboard = this.telemetryManager.getTelemetryDashboard();

    // Determine overall health
    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (routingMetrics.circuitBreakersOpen > 0) {
      issues.push(`${routingMetrics.circuitBreakersOpen} circuit breakers open`);
      status = 'degraded';
    }

    if (certificateMetrics.expiredCertificates > 0) {
      issues.push(`${certificateMetrics.expiredCertificates} expired certificates`);
      status = 'degraded';
    }

    if (telemetryDashboard.overview.sloStatus.violated > 0) {
      issues.push(`${telemetryDashboard.overview.sloStatus.violated} SLOs violated`);
      status = 'unhealthy';
    }

    if (istioMetrics.meshHealth.status !== 'healthy') {
      issues.push(...istioMetrics.meshHealth.issues);
      status = istioMetrics.meshHealth.status;
    }

    return {
      istio: istioMetrics,
      trafficRouting: routingMetrics,
      security: certificateMetrics,
      telemetry: telemetryDashboard,
      overall: {
        status,
        issues,
        services: istioMetrics.registeredServices,
        certificatesValid: certificateMetrics.validCertificates,
        slosViolated: telemetryDashboard.overview.sloStatus.violated
      }
    };
  }

  /**
   * Setup real-time monitoring
   */
  setupMonitoring(port: number): void {
    this.telemetryManager.setupRealtimeStreaming(port);

    logger.info('Service mesh monitoring enabled', {
      port,
      features: ['real-time metrics', 'distributed tracing', 'health checks', 'SLO monitoring']
    });
  }

  /**
   * Enable advanced security features
   */
  async enableAdvancedSecurity(): Promise<void> {
    logger.info('Enabling advanced security features');

    try {
      // Configure default mTLS policy
      const defaultTLSPolicy: TLSPolicy = {
        serviceName: 'default',
        namespace: 'istio-system',
        mode: 'STRICT',
        cipherSuites: [
          'ECDHE-RSA-AES256-GCM-SHA384',
          'ECDHE-RSA-AES128-GCM-SHA256'
        ],
        minTlsVersion: '1.2',
        maxTlsVersion: '1.3',
        certificateValidation: {
          validateCertificateChain: true,
          validateHostname: true,
          allowSelfSigned: false,
          customCAs: []
        },
        rotationPolicy: {
          autoRotate: true,
          rotateBeforeExpiryDays: 30,
          rotationCheckInterval: 6
        }
      };

      this.mtlsManager.configureTLSPolicy(defaultTLSPolicy);

      // Enable distributed tracing
      await this.istioManager.enableDistributedTracing('*', {
        samplingRate: 1.0, // 100% sampling for full visibility
        customTags: {
          'mesh.version': '1.0',
          'security.mtls': 'enabled'
        }
      });

      logger.info('Advanced security features enabled');

    } catch (error) {
      logger.error('Failed to enable advanced security features', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Private methods

  private setupComponentIntegration(): void {
    // Integrate traffic routing with telemetry
    this.trafficRouter.on('healthUpdate', (data) => {
      const metrics: ServiceMeshMetrics = {
        serviceName: data.serviceName,
        version: data.health.version,
        namespace: 'default',
        timestamp: new Date(),
        requestRate: 0,
        requestDuration: { p50: 0, p95: 0, p99: 0, mean: 0 },
        requestSize: { mean: 0, p95: 0 },
        responseSize: { mean: 0, p95: 0 },
        errorRate: data.health.status === 'healthy' ? 0 : 10,
        errorsByCode: {},
        activeConnections: 0,
        connectionRate: 0,
        connectionDuration: { mean: 0, p95: 0 },
        circuitBreakerState: 'closed',
        circuitBreakerTrips: 0,
        retryCount: 0,
        retrySuccessRate: 100,
        upstreamConnections: {},
        loadBalancingAlgorithm: 'round_robin'
      };

      this.telemetryManager.collectServiceMetrics(metrics);
    });

    // Integrate certificate events with telemetry
    this.mtlsManager.on('certificateExpired', (data) => {
      logger.warn('Certificate expired detected in mesh', data);
    });

    this.mtlsManager.on('certificateRevoked', (data) => {
      logger.warn('Certificate revoked detected in mesh', data);
    });

    // Integrate telemetry alerts with traffic management
    this.telemetryManager.on('alert', (alert) => {
      if (alert.type === 'high_error_rate' && alert.severity === 'critical') {
        // Could trigger automatic traffic shifting or circuit breaking
        logger.warn('High error rate alert - consider automated response', alert);
      }
    });

    logger.debug('Service mesh component integration configured');
  }
}
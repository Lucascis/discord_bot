/**
 * Intelligent Traffic Routing System
 * Advanced traffic management with ML-driven decisions
 */

import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';

/**
 * Traffic Metrics
 */
export interface TrafficMetrics {
  serviceName: string;
  endpoint: string;
  requestRate: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  successRate: number;
  activeConnections: number;
  timestamp: Date;
}

/**
 * Service Health Status
 */
export interface ServiceHealth {
  serviceName: string;
  version: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number; // 0-1, higher is better
  lastUpdate: Date;
  issues: string[];
}

/**
 * Routing Decision
 */
export interface RoutingDecision {
  targetService: string;
  targetVersion: string;
  confidence: number;
  reasons: string[];
  fallbackOptions: Array<{
    service: string;
    version: string;
    priority: number;
  }>;
  metadata: {
    algorithm: 'round_robin' | 'least_connections' | 'weighted' | 'ml_optimized';
    loadBalancingFactor: number;
    healthScore: number;
    latencyScore: number;
  };
}

/**
 * Traffic Routing Rule
 */
export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  conditions: Array<{
    type: 'header' | 'path' | 'method' | 'user_agent' | 'geo_location' | 'time' | 'custom';
    field: string;
    operator: 'equals' | 'contains' | 'starts_with' | 'regex' | 'in_range';
    value: any;
  }>;
  actions: Array<{
    type: 'route' | 'redirect' | 'fault_injection' | 'rate_limit' | 'retry';
    configuration: Record<string, any>;
  }>;
  isActive: boolean;
  metadata: {
    createdBy: string;
    createdAt: Date;
    lastModified: Date;
    description: string;
  };
}

/**
 * Circuit Breaker State
 */
export interface CircuitBreakerState {
  serviceName: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureTime: Date;
  nextRetryTime: Date;
  successThreshold: number;
  failureThreshold: number;
  timeout: number;
}

/**
 * Intelligent Traffic Router
 */
export class IntelligentTrafficRouter extends EventEmitter {
  private readonly metrics?: MetricsCollector;

  // Service registry and health tracking
  private readonly serviceHealth = new Map<string, ServiceHealth>();
  private readonly trafficMetrics = new Map<string, TrafficMetrics[]>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  // Routing configuration
  private readonly routingRules = new Map<string, RoutingRule>();
  private readonly loadBalancingWeights = new Map<string, Map<string, number>>();

  // ML-based optimization
  private readonly historicalDecisions: Array<{
    request: any;
    decision: RoutingDecision;
    outcome: {
      success: boolean;
      latency: number;
      errorCode?: number;
    };
    timestamp: Date;
  }> = [];

  // Performance tracking
  private routingDecisions = 0;
  private totalDecisionTime = 0;
  private optimizationRuns = 0;

  constructor(metrics?: MetricsCollector) {
    super();
    this.metrics = metrics;

    // Start periodic optimization
    this.startPeriodicOptimization();

    logger.info('Intelligent Traffic Router initialized');
  }

  /**
   * Make intelligent routing decision
   */
  async makeRoutingDecision(request: {
    serviceName: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    userContext?: {
      userId: string;
      geoLocation: string;
      userAgent: string;
    };
  }): Promise<RoutingDecision> {
    const startTime = Date.now();

    try {
      // Get available service versions
      const availableVersions = await this.getAvailableVersions(request.serviceName);

      // Apply routing rules
      const ruleBasedRouting = await this.applyRoutingRules(request);
      if (ruleBasedRouting) {
        return this.recordDecision(ruleBasedRouting, Date.now() - startTime);
      }

      // Check circuit breakers
      const healthyVersions = this.filterHealthyVersions(availableVersions);

      if (healthyVersions.length === 0) {
        throw new Error(`No healthy versions available for service ${request.serviceName}`);
      }

      // ML-optimized routing decision
      const decision = await this.makeMLOptimizedDecision(request, healthyVersions);

      return this.recordDecision(decision, Date.now() - startTime);

    } catch (error) {
      this.recordMetrics('routing_decision_error', Date.now() - startTime);

      logger.error('Failed to make routing decision', {
        service: request.serviceName,
        error: error instanceof Error ? error.message : String(error)
      });

      // Return fallback decision
      return this.createFallbackDecision(request.serviceName);
    }
  }

  /**
   * Update service health metrics
   */
  updateServiceHealth(serviceName: string, version: string, metrics: TrafficMetrics): void {
    // Calculate health score
    const healthScore = this.calculateHealthScore(metrics);

    const health: ServiceHealth = {
      serviceName,
      version,
      status: this.determineHealthStatus(healthScore),
      score: healthScore,
      lastUpdate: new Date(),
      issues: this.identifyHealthIssues(metrics)
    };

    this.serviceHealth.set(`${serviceName}:${version}`, health);

    // Store traffic metrics for analysis
    if (!this.trafficMetrics.has(serviceName)) {
      this.trafficMetrics.set(serviceName, []);
    }

    const serviceMetrics = this.trafficMetrics.get(serviceName)!;
    serviceMetrics.push(metrics);

    // Keep only recent metrics (last 1000 data points)
    if (serviceMetrics.length > 1000) {
      serviceMetrics.splice(0, serviceMetrics.length - 1000);
    }

    // Update circuit breaker
    this.updateCircuitBreaker(serviceName, metrics);

    // Emit health update event
    this.emit('healthUpdate', { serviceName, version, health });
  }

  /**
   * Create routing rule
   */
  createRoutingRule(rule: RoutingRule): void {
    this.routingRules.set(rule.id, rule);

    logger.info('Routing rule created', {
      ruleId: rule.id,
      name: rule.name,
      priority: rule.priority,
      conditions: rule.conditions.length,
      actions: rule.actions.length
    });
  }

  /**
   * Perform canary analysis
   */
  async performCanaryAnalysis(
    serviceName: string,
    canaryVersion: string,
    stableVersion: string,
    analysisConfig: {
      duration: number; // minutes
      trafficSplit: number; // percentage to canary
      successCriteria: {
        maxErrorRate: number;
        maxLatencyIncrease: number; // percentage
        minRequestCount: number;
      };
    }
  ): Promise<{
    recommendation: 'promote' | 'rollback' | 'continue';
    confidence: number;
    metrics: {
      canary: TrafficMetrics;
      stable: TrafficMetrics;
      comparison: {
        errorRateDelta: number;
        latencyDelta: number;
        successRateDelta: number;
      };
    };
    reasons: string[];
  }> {
    logger.info('Starting canary analysis', {
      service: serviceName,
      canaryVersion,
      stableVersion,
      duration: analysisConfig.duration,
      trafficSplit: analysisConfig.trafficSplit
    });

    try {
      // Get metrics for both versions
      const canaryMetrics = await this.getServiceMetrics(serviceName, canaryVersion);
      const stableMetrics = await this.getServiceMetrics(serviceName, stableVersion);

      if (!canaryMetrics || !stableMetrics) {
        return {
          recommendation: 'continue',
          confidence: 0,
          metrics: {} as any,
          reasons: ['Insufficient metrics data']
        };
      }

      // Calculate deltas
      const errorRateDelta = canaryMetrics.errorRate - stableMetrics.errorRate;
      const latencyDelta = ((canaryMetrics.latencyP95 - stableMetrics.latencyP95) / stableMetrics.latencyP95) * 100;
      const successRateDelta = canaryMetrics.successRate - stableMetrics.successRate;

      const reasons: string[] = [];
      let recommendation: 'promote' | 'rollback' | 'continue' = 'continue';
      let confidence = 0;

      // Check success criteria
      if (canaryMetrics.requestRate < analysisConfig.successCriteria.minRequestCount) {
        reasons.push('Insufficient request volume for analysis');
        recommendation = 'continue';
        confidence = 0.1;
      } else {
        // Evaluate error rate
        if (errorRateDelta > analysisConfig.successCriteria.maxErrorRate) {
          reasons.push(`Error rate increased by ${errorRateDelta.toFixed(2)}%`);
          recommendation = 'rollback';
          confidence = 0.9;
        }

        // Evaluate latency
        if (latencyDelta > analysisConfig.successCriteria.maxLatencyIncrease) {
          reasons.push(`Latency increased by ${latencyDelta.toFixed(2)}%`);
          if (recommendation !== 'rollback') {
            recommendation = 'rollback';
            confidence = 0.8;
          }
        }

        // Positive signals
        if (errorRateDelta <= 0 && latencyDelta <= 5 && successRateDelta >= 0) {
          reasons.push('All metrics within acceptable ranges');
          recommendation = 'promote';
          confidence = 0.85;
        }
      }

      const result = {
        recommendation,
        confidence,
        metrics: {
          canary: canaryMetrics,
          stable: stableMetrics,
          comparison: {
            errorRateDelta,
            latencyDelta,
            successRateDelta
          }
        },
        reasons
      };

      logger.info('Canary analysis completed', {
        service: serviceName,
        recommendation,
        confidence,
        reasons: reasons.length
      });

      return result;

    } catch (error) {
      logger.error('Canary analysis failed', {
        service: serviceName,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        recommendation: 'rollback',
        confidence: 0.95,
        metrics: {} as any,
        reasons: ['Analysis failed - recommending rollback for safety']
      };
    }
  }

  /**
   * Get traffic routing metrics
   */
  getRoutingMetrics(): {
    routingDecisions: number;
    averageDecisionTime: number;
    optimizationRuns: number;
    activeRules: number;
    healthyServices: number;
    circuitBreakersOpen: number;
    mlAccuracy: number;
  } {
    const healthyServices = Array.from(this.serviceHealth.values())
      .filter(h => h.status === 'healthy').length;

    const circuitBreakersOpen = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'open').length;

    const mlAccuracy = this.calculateMLAccuracy();

    return {
      routingDecisions: this.routingDecisions,
      averageDecisionTime: this.routingDecisions > 0 ? this.totalDecisionTime / this.routingDecisions : 0,
      optimizationRuns: this.optimizationRuns,
      activeRules: Array.from(this.routingRules.values()).filter(r => r.isActive).length,
      healthyServices,
      circuitBreakersOpen,
      mlAccuracy
    };
  }

  // Private methods

  private async getAvailableVersions(serviceName: string): Promise<Array<{
    version: string;
    weight: number;
    isHealthy: boolean;
  }>> {
    // In a real implementation, this would query service registry
    const versions = Array.from(this.serviceHealth.keys())
      .filter(key => key.startsWith(`${serviceName}:`))
      .map(key => {
        const version = key.split(':')[1];
        const health = this.serviceHealth.get(key)!;
        const weights = this.loadBalancingWeights.get(serviceName) || new Map();

        return {
          version,
          weight: weights.get(version) || 1,
          isHealthy: health.status === 'healthy'
        };
      });

    return versions;
  }

  private async applyRoutingRules(request: any): Promise<RoutingDecision | null> {
    const applicableRules = Array.from(this.routingRules.values())
      .filter(rule => rule.isActive)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of applicableRules) {
      const matches = await this.evaluateRuleConditions(rule, request);
      if (matches) {
        return this.executeRuleActions(rule, request);
      }
    }

    return null;
  }

  private async evaluateRuleConditions(rule: RoutingRule, request: any): Promise<boolean> {
    for (const condition of rule.conditions) {
      if (!await this.evaluateCondition(condition, request)) {
        return false;
      }
    }
    return true;
  }

  private async evaluateCondition(condition: any, request: any): Promise<boolean> {
    let value: any;

    switch (condition.type) {
      case 'header':
        value = request.headers[condition.field];
        break;
      case 'path':
        value = request.path;
        break;
      case 'method':
        value = request.method;
        break;
      case 'user_agent':
        value = request.headers['user-agent'];
        break;
      case 'geo_location':
        value = request.userContext?.geoLocation;
        break;
      case 'time':
        value = new Date().getHours();
        break;
      default:
        return true;
    }

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        return String(value).includes(condition.value);
      case 'starts_with':
        return String(value).startsWith(condition.value);
      case 'regex':
        return new RegExp(condition.value).test(String(value));
      case 'in_range':
        return value >= condition.value.min && value <= condition.value.max;
      default:
        return false;
    }
  }

  private async executeRuleActions(rule: RoutingRule, request: any): Promise<RoutingDecision> {
    const routeAction = rule.actions.find(action => action.type === 'route');

    if (routeAction) {
      return {
        targetService: routeAction.configuration.targetService,
        targetVersion: routeAction.configuration.targetVersion,
        confidence: 0.95,
        reasons: [`Matched routing rule: ${rule.name}`],
        fallbackOptions: [],
        metadata: {
          algorithm: 'round_robin',
          loadBalancingFactor: 1,
          healthScore: 1,
          latencyScore: 1
        }
      };
    }

    throw new Error('No valid route action found in rule');
  }

  private filterHealthyVersions(versions: Array<{ version: string; weight: number; isHealthy: boolean }>): Array<{ version: string; weight: number }> {
    return versions
      .filter(v => v.isHealthy)
      .map(v => ({ version: v.version, weight: v.weight }));
  }

  private async makeMLOptimizedDecision(
    request: any,
    healthyVersions: Array<{ version: string; weight: number }>
  ): Promise<RoutingDecision> {
    // Simplified ML-based decision making
    // In a real implementation, this would use a trained model

    const versionScores = healthyVersions.map(v => {
      const health = this.serviceHealth.get(`${request.serviceName}:${v.version}`);
      const recentMetrics = this.getRecentMetrics(request.serviceName, v.version);

      const healthScore = health?.score || 0.5;
      const latencyScore = recentMetrics ? 1 - (recentMetrics.latencyP95 / 1000) : 0.5; // Normalize latency
      const loadScore = 1 - (recentMetrics?.activeConnections || 0) / 100; // Normalize load

      const compositeScore = (healthScore * 0.4) + (latencyScore * 0.3) + (loadScore * 0.3);

      return {
        version: v.version,
        score: compositeScore,
        weight: v.weight
      };
    });

    // Select highest scoring version
    const bestVersion = versionScores.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    const fallbackOptions = versionScores
      .filter(v => v.version !== bestVersion.version)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((v, index) => ({
        service: request.serviceName,
        version: v.version,
        priority: index + 1
      }));

    return {
      targetService: request.serviceName,
      targetVersion: bestVersion.version,
      confidence: bestVersion.score,
      reasons: ['ML-optimized routing based on health, latency, and load'],
      fallbackOptions,
      metadata: {
        algorithm: 'ml_optimized',
        loadBalancingFactor: bestVersion.weight,
        healthScore: this.serviceHealth.get(`${request.serviceName}:${bestVersion.version}`)?.score || 0,
        latencyScore: versionScores.find(v => v.version === bestVersion.version)?.score || 0
      }
    };
  }

  private calculateHealthScore(metrics: TrafficMetrics): number {
    // Calculate composite health score (0-1)
    const errorRateScore = Math.max(0, 1 - (metrics.errorRate / 10)); // 10% error rate = 0 score
    const latencyScore = Math.max(0, 1 - (metrics.latencyP95 / 2000)); // 2s latency = 0 score
    const successRateScore = metrics.successRate / 100;

    return (errorRateScore * 0.4) + (latencyScore * 0.3) + (successRateScore * 0.3);
  }

  private determineHealthStatus(score: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (score > 0.8) return 'healthy';
    if (score > 0.5) return 'degraded';
    return 'unhealthy';
  }

  private identifyHealthIssues(metrics: TrafficMetrics): string[] {
    const issues: string[] = [];

    if (metrics.errorRate > 5) {
      issues.push(`High error rate: ${metrics.errorRate.toFixed(2)}%`);
    }

    if (metrics.latencyP95 > 1000) {
      issues.push(`High latency: ${metrics.latencyP95}ms P95`);
    }

    if (metrics.successRate < 95) {
      issues.push(`Low success rate: ${metrics.successRate.toFixed(2)}%`);
    }

    return issues;
  }

  private updateCircuitBreaker(serviceName: string, metrics: TrafficMetrics): void {
    let circuitBreaker = this.circuitBreakers.get(serviceName);

    if (!circuitBreaker) {
      circuitBreaker = {
        serviceName,
        state: 'closed',
        failureCount: 0,
        lastFailureTime: new Date(),
        nextRetryTime: new Date(),
        successThreshold: 5,
        failureThreshold: 10,
        timeout: 60000 // 1 minute
      };
      this.circuitBreakers.set(serviceName, circuitBreaker);
    }

    const isFailure = metrics.errorRate > 10 || metrics.latencyP95 > 2000;

    if (isFailure) {
      circuitBreaker.failureCount++;
      circuitBreaker.lastFailureTime = new Date();

      if (circuitBreaker.failureCount >= circuitBreaker.failureThreshold) {
        circuitBreaker.state = 'open';
        circuitBreaker.nextRetryTime = new Date(Date.now() + circuitBreaker.timeout);

        this.emit('circuitBreakerOpened', { serviceName, circuitBreaker });
      }
    } else {
      if (circuitBreaker.state === 'half_open') {
        circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);

        if (circuitBreaker.failureCount === 0) {
          circuitBreaker.state = 'closed';
          this.emit('circuitBreakerClosed', { serviceName, circuitBreaker });
        }
      }
    }

    // Transition from open to half-open
    if (circuitBreaker.state === 'open' && Date.now() > circuitBreaker.nextRetryTime.getTime()) {
      circuitBreaker.state = 'half_open';
      this.emit('circuitBreakerHalfOpen', { serviceName, circuitBreaker });
    }
  }

  private getServiceMetrics(serviceName: string, version: string): TrafficMetrics | null {
    const metrics = this.trafficMetrics.get(serviceName);
    if (!metrics || metrics.length === 0) return null;

    // Return most recent metrics
    return metrics[metrics.length - 1];
  }

  private getRecentMetrics(serviceName: string, version: string): TrafficMetrics | null {
    return this.getServiceMetrics(serviceName, version);
  }

  private createFallbackDecision(serviceName: string): RoutingDecision {
    return {
      targetService: serviceName,
      targetVersion: 'stable',
      confidence: 0.1,
      reasons: ['Fallback routing due to error'],
      fallbackOptions: [],
      metadata: {
        algorithm: 'round_robin',
        loadBalancingFactor: 1,
        healthScore: 0,
        latencyScore: 0
      }
    };
  }

  private recordDecision(decision: RoutingDecision, duration: number): RoutingDecision {
    this.routingDecisions++;
    this.totalDecisionTime += duration;
    this.recordMetrics('routing_decision_made', duration);

    return decision;
  }

  private startPeriodicOptimization(): void {
    setInterval(() => {
      this.optimizeLoadBalancing();
    }, 300000); // Every 5 minutes
  }

  private optimizeLoadBalancing(): void {
    this.optimizationRuns++;

    for (const [serviceName, metrics] of this.trafficMetrics) {
      if (metrics.length < 10) continue; // Need sufficient data

      const recentMetrics = metrics.slice(-10);
      const avgLatency = recentMetrics.reduce((sum, m) => sum + m.latencyP95, 0) / recentMetrics.length;
      const avgErrorRate = recentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / recentMetrics.length;

      // Adjust weights based on performance
      // This is a simplified optimization - real implementation would be more sophisticated
      const weights = this.loadBalancingWeights.get(serviceName) || new Map();

      for (const metric of recentMetrics) {
        const currentWeight = weights.get(metric.endpoint) || 1;
        let newWeight = currentWeight;

        if (metric.latencyP95 < avgLatency && metric.errorRate < avgErrorRate) {
          newWeight = Math.min(2, currentWeight * 1.1); // Increase weight for good performers
        } else if (metric.latencyP95 > avgLatency * 1.5 || metric.errorRate > avgErrorRate * 2) {
          newWeight = Math.max(0.1, currentWeight * 0.9); // Decrease weight for poor performers
        }

        weights.set(metric.endpoint, newWeight);
      }

      this.loadBalancingWeights.set(serviceName, weights);
    }

    logger.debug('Load balancing optimization completed', {
      services: this.trafficMetrics.size,
      optimizationRuns: this.optimizationRuns
    });
  }

  private calculateMLAccuracy(): number {
    if (this.historicalDecisions.length < 10) return 0;

    const recentDecisions = this.historicalDecisions.slice(-100);
    const successfulDecisions = recentDecisions.filter(d => d.outcome.success).length;

    return successfulDecisions / recentDecisions.length;
  }

  private recordMetrics(type: 'routing_decision_made' | 'routing_decision_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'intelligent_routing_operations_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'intelligent_routing_decision_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}
import { EventEmitter } from 'eventemitter3';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Chaos Experiment Types
 */
export type ChaosExperimentType =
  | 'latency'        // Inject artificial latency
  | 'error'          // Inject random errors
  | 'timeout'        // Cause operations to timeout
  | 'resource_leak'  // Simulate resource exhaustion
  | 'network_partition' // Simulate network issues
  | 'cpu_stress'     // Simulate high CPU usage
  | 'memory_stress'; // Simulate memory pressure

/**
 * Chaos Configuration
 */
export interface ChaosConfig {
  /** Enable chaos engineering */
  enabled: boolean;

  /** Environment filter (only run in specified environments) */
  allowedEnvironments: string[];

  /** Global probability of any chaos being injected (0-1) */
  globalProbability: number;

  /** Experiments configuration */
  experiments: {
    [K in ChaosExperimentType]: {
      enabled: boolean;
      probability: number;
      parameters: Record<string, unknown>;
    };
  };

  /** Targeting rules */
  targeting: {
    /** Service names to target */
    services?: string[];

    /** Operation patterns to target */
    operations?: string[];

    /** User segments to target */
    userSegments?: string[];

    /** Time windows for chaos injection */
    timeWindows?: Array<{
      start: string; // HH:MM format
      end: string;   // HH:MM format
      timezone: string;
    }>;
  };

  /** Safety mechanisms */
  safety: {
    /** Maximum chaos injection rate per minute */
    maxInjectionRate: number;

    /** Circuit breaker for chaos injection */
    circuitBreaker: {
      enabled: boolean;
      errorThreshold: number;
      timeWindow: number;
    };

    /** Automatic disable on high error rates */
    autoDisable: {
      enabled: boolean;
      errorRateThreshold: number;
      timeWindow: number;
    };
  };
}

/**
 * Chaos Experiment Result
 */
export interface ChaosExperimentResult {
  type: ChaosExperimentType;
  injected: boolean;
  reason?: string;
  parameters?: Record<string, unknown>;
  timestamp: Date;
  targetService?: string;
  targetOperation?: string;
  targetUser?: string;
}

/**
 * Chaos Metrics
 */
export interface ChaosMetrics {
  totalExperiments: number;
  successfulInjections: number;
  failedInjections: number;
  skippedInjections: number;
  experimentsByType: Record<ChaosExperimentType, number>;
  injectionRate: number; // injections per minute
  lastInjection: Date | null;
  safetyTriggered: number;
}

/**
 * Chaos Monkey Implementation
 * Implements chaos engineering patterns for resilience testing
 */
export class ChaosMonkey extends EventEmitter {
  private readonly config: ChaosConfig;
  private readonly metrics?: MetricsCollector;
  private readonly environment: string;

  // State tracking
  private readonly experimentHistory: ChaosExperimentResult[] = [];
  private injectionCount = 0;
  private safetyTriggered = 0;
  private lastInjection: Date | null = null;
  private circuitOpen = false;
  private autoDisabled = false;

  // Rate limiting
  private readonly injectionRateWindow: number[] = [];
  private readonly RATE_WINDOW_MS = 60000; // 1 minute

  constructor(
    config: ChaosConfig,
    environment: string = process.env.NODE_ENV || 'development',
    metrics?: MetricsCollector
  ) {
    super();
    this.config = config;
    this.environment = environment;
    this.metrics = metrics;

    // Validate environment
    if (!config.allowedEnvironments.includes(environment)) {
      logger.warn('Chaos engineering disabled for this environment', {
        environment,
        allowedEnvironments: config.allowedEnvironments
      });
      this.config.enabled = false;
    }

    // Start safety monitoring
    if (config.enabled) {
      this.startSafetyMonitoring();
    }

    logger.info('Chaos Monkey initialized', {
      enabled: config.enabled,
      environment,
      globalProbability: config.globalProbability,
      experimentsEnabled: Object.entries(config.experiments)
        .filter(([, exp]) => exp.enabled)
        .map(([type]) => type)
    });
  }

  /**
   * Inject chaos into an operation
   */
  async injectChaos<T>(
    operation: () => Promise<T>,
    context: {
      service?: string;
      operation?: string;
      userId?: string;
    } = {}
  ): Promise<T> {
    // Check if chaos is enabled and safe to inject
    if (!this.shouldInjectChaos(context)) {
      return await operation();
    }

    // Select chaos experiment
    const experiment = this.selectExperiment();
    if (!experiment) {
      return await operation();
    }

    // Record injection attempt
    this.recordInjection();

    try {
      return await this.executeWithChaos(operation, experiment, context);
    } catch (error) {
      // Record failed injection
      this.recordExperiment({
        type: experiment,
        injected: false,
        reason: 'injection_failed',
        timestamp: new Date(),
        ...context
      });

      throw error;
    }
  }

  /**
   * Get chaos metrics
   */
  getMetrics(): ChaosMetrics {
    const now = Date.now();
    const recentInjections = this.injectionRateWindow.filter(
      timestamp => now - timestamp < this.RATE_WINDOW_MS
    );

    const experimentsByType: Record<ChaosExperimentType, number> = {
      latency: 0,
      error: 0,
      timeout: 0,
      resource_leak: 0,
      network_partition: 0,
      cpu_stress: 0,
      memory_stress: 0
    };

    this.experimentHistory.forEach(exp => {
      if (exp.injected) {
        experimentsByType[exp.type]++;
      }
    });

    return {
      totalExperiments: this.experimentHistory.length,
      successfulInjections: this.experimentHistory.filter(exp => exp.injected).length,
      failedInjections: this.experimentHistory.filter(exp => !exp.injected).length,
      skippedInjections: this.injectionCount - this.experimentHistory.filter(exp => exp.injected).length,
      experimentsByType,
      injectionRate: recentInjections.length,
      lastInjection: this.lastInjection,
      safetyTriggered: this.safetyTriggered
    };
  }

  /**
   * Enable/disable chaos injection
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.autoDisabled = false;
    this.circuitOpen = false;

    this.emit('status_change', { enabled, reason: 'manual' });

    logger.info('Chaos injection status changed', { enabled });
  }

  /**
   * Reset chaos monkey state
   */
  reset(): void {
    this.experimentHistory.length = 0;
    this.injectionCount = 0;
    this.safetyTriggered = 0;
    this.lastInjection = null;
    this.circuitOpen = false;
    this.autoDisabled = false;
    this.injectionRateWindow.length = 0;

    logger.info('Chaos Monkey state reset');
  }

  // Private methods

  private shouldInjectChaos(context: Record<string, unknown>): boolean {
    // Check if chaos is enabled
    if (!this.config.enabled || this.autoDisabled || this.circuitOpen) {
      return false;
    }

    // Check rate limiting
    if (!this.checkRateLimit()) {
      return false;
    }

    // Check global probability
    if (Math.random() > this.config.globalProbability) {
      return false;
    }

    // Check targeting rules
    if (!this.matchesTargeting(context)) {
      return false;
    }

    // Check time windows
    if (!this.isInTimeWindow()) {
      return false;
    }

    return true;
  }

  private selectExperiment(): ChaosExperimentType | null {
    const enabledExperiments = Object.entries(this.config.experiments)
      .filter(([, exp]) => exp.enabled)
      .map(([type, exp]) => ({ type: type as ChaosExperimentType, probability: exp.probability }));

    if (enabledExperiments.length === 0) {
      return null;
    }

    // Weighted random selection
    const totalWeight = enabledExperiments.reduce((sum, exp) => sum + exp.probability, 0);
    let random = Math.random() * totalWeight;

    for (const experiment of enabledExperiments) {
      random -= experiment.probability;
      if (random <= 0) {
        return experiment.type;
      }
    }

    return enabledExperiments[0].type; // Fallback
  }

  private async executeWithChaos<T>(
    operation: () => Promise<T>,
    experiment: ChaosExperimentType,
    context: Record<string, unknown>
  ): Promise<T> {
    const experimentConfig = this.config.experiments[experiment];
    // Track experiment execution time for debugging

    try {
      switch (experiment) {
        case 'latency':
          await this.injectLatency(experimentConfig.parameters);
          break;

        case 'error':
          this.injectError(experimentConfig.parameters);
          break;

        case 'timeout':
          return await this.injectTimeout(operation, experimentConfig.parameters);

        case 'resource_leak':
          this.injectResourceLeak(experimentConfig.parameters);
          break;

        case 'network_partition':
          this.injectNetworkPartition(experimentConfig.parameters);
          break;

        case 'cpu_stress':
          this.injectCpuStress(experimentConfig.parameters);
          break;

        case 'memory_stress':
          this.injectMemoryStress(experimentConfig.parameters);
          break;
      }

      const result = await operation();

      // Record successful injection
      this.recordExperiment({
        type: experiment,
        injected: true,
        parameters: experimentConfig.parameters,
        timestamp: new Date(),
        ...context
      });

      return result;

    } catch (error) {
      // Check if error was caused by chaos injection
      const isChaosError = this.isChaosError(error as Error, experiment);

      this.recordExperiment({
        type: experiment,
        injected: isChaosError,
        reason: isChaosError ? 'chaos_induced' : 'operation_failed',
        parameters: experimentConfig.parameters,
        timestamp: new Date(),
        ...context
      });

      throw error;
    }
  }

  private async injectLatency(params: { minMs: number; maxMs: number }): Promise<void> {
    const delay = Math.random() * (params.maxMs - params.minMs) + params.minMs;
    await new Promise(resolve => setTimeout(resolve, delay));

    logger.debug('Chaos: Latency injected', { delayMs: delay });
  }

  private injectError(params: { errorRate: number; errorTypes: string[] }): void {
    if (Math.random() < params.errorRate) {
      const errorType = params.errorTypes[Math.floor(Math.random() * params.errorTypes.length)];
      logger.debug('Chaos: Error injected', { errorType });
      throw new Error(`Chaos-induced error: ${errorType}`);
    }
  }

  private async injectTimeout<T>(
    operation: () => Promise<T>,
    params: { timeoutMs: number }
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        logger.debug('Chaos: Timeout injected', { timeoutMs: params.timeoutMs });
        reject(new Error('Chaos-induced timeout'));
      }, params.timeoutMs);
    });

    return await Promise.race([operation(), timeoutPromise]);
  }

  private injectResourceLeak(params: { leakType: 'memory' | 'handles'; amount: number }): void {
    if (params.leakType === 'memory') {
      // Allocate memory that won't be garbage collected
      const leakArray: unknown[] = [];
      for (let i = 0; i < params.amount; i++) {
        leakArray.push(new Array(1000).fill('chaos'));
      }
      (global as Record<string, unknown>).__chaosMemoryLeak = (global as Record<string, unknown>).__chaosMemoryLeak || [];
      ((global as Record<string, unknown>).__chaosMemoryLeak as unknown[]).push(leakArray);
    }

    logger.debug('Chaos: Resource leak injected', params);
  }

  private injectNetworkPartition(params: { duration: number; dropRate: number }): void {
    // Simulate network issues
    if (Math.random() < params.dropRate) {
      throw new Error('Chaos-induced network partition');
    }

    logger.debug('Chaos: Network partition simulated', params);
  }

  private injectCpuStress(params: { durationMs: number; intensity: number }): void {
    const endTime = Date.now() + params.durationMs;
    const iterations = params.intensity * 1000;

    setImmediate(() => {
      while (Date.now() < endTime) {
        // Busy work to stress CPU
        for (let i = 0; i < iterations; i++) {
          Math.random();
        }
      }
    });

    logger.debug('Chaos: CPU stress injected', params);
  }

  private injectMemoryStress(params: { sizeBytes: number; durationMs: number }): void {
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunks = Math.ceil(params.sizeBytes / chunkSize);
    const memoryStress: Buffer[] = [];

    for (let i = 0; i < chunks; i++) {
      memoryStress.push(Buffer.alloc(chunkSize));
    }

    setTimeout(() => {
      memoryStress.length = 0; // Release memory
    }, params.durationMs);

    logger.debug('Chaos: Memory stress injected', params);
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const recent = this.injectionRateWindow.filter(
      timestamp => now - timestamp < this.RATE_WINDOW_MS
    );

    return recent.length < this.config.safety.maxInjectionRate;
  }

  private matchesTargeting(context: Record<string, unknown>): boolean {
    const { targeting } = this.config;

    if (targeting.services && context.service) {
      if (!targeting.services.includes(context.service)) {
        return false;
      }
    }

    if (targeting.operations && context.operation) {
      const matches = targeting.operations.some(pattern =>
        new RegExp(pattern).test(context.operation)
      );
      if (!matches) {
        return false;
      }
    }

    return true;
  }

  private isInTimeWindow(): boolean {
    const { timeWindows } = this.config.targeting;
    if (!timeWindows || timeWindows.length === 0) {
      return true;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return timeWindows.some(window => {
      return currentTime >= window.start && currentTime <= window.end;
    });
  }

  private recordInjection(): void {
    this.injectionCount++;
    this.lastInjection = new Date();
    this.injectionRateWindow.push(Date.now());

    // Clean up old rate tracking data
    const cutoff = Date.now() - this.RATE_WINDOW_MS;
    while (this.injectionRateWindow.length > 0 && this.injectionRateWindow[0] < cutoff) {
      this.injectionRateWindow.shift();
    }
  }

  private recordExperiment(result: ChaosExperimentResult): void {
    this.experimentHistory.push(result);

    // Keep only recent history
    if (this.experimentHistory.length > 1000) {
      this.experimentHistory.shift();
    }

    this.emit('experiment', result);

    if (this.metrics) {
      this.metrics.recordCustomMetric(
        'chaos_experiments_total',
        1,
        {
          type: result.type,
          injected: result.injected.toString(),
          service: result.targetService || 'unknown'
        },
        'counter'
      );
    }
  }

  private isChaosError(error: Error, experiment: ChaosExperimentType): boolean {
    return error.message.includes('Chaos-induced') ||
           error.message.includes('chaos') ||
           (experiment === 'timeout' && error.message.includes('timeout')) ||
           (experiment === 'network_partition' && error.message.includes('network'));
  }

  private startSafetyMonitoring(): void {
    const { safety } = this.config;

    if (safety.circuitBreaker.enabled || safety.autoDisable.enabled) {
      setInterval(() => {
        this.checkSafetyConditions();
      }, 30000); // Check every 30 seconds
    }
  }

  private checkSafetyConditions(): void {
    // Get current safety metrics for evaluation
    const { safety } = this.config;

    // Check circuit breaker
    if (safety.circuitBreaker.enabled) {
      const recentExperiments = this.experimentHistory.filter(
        exp => Date.now() - exp.timestamp.getTime() < safety.circuitBreaker.timeWindow
      );

      if (recentExperiments.length > 0) {
        const errorRate = recentExperiments.filter(exp => !exp.injected).length / recentExperiments.length;

        if (errorRate > safety.circuitBreaker.errorThreshold) {
          this.circuitOpen = true;
          this.safetyTriggered++;

          this.emit('safety_triggered', {
            type: 'circuit_breaker',
            errorRate,
            threshold: safety.circuitBreaker.errorThreshold
          });

          logger.warn('Chaos injection circuit breaker opened', {
            errorRate,
            threshold: safety.circuitBreaker.errorThreshold
          });
        }
      }
    }

    // Check auto-disable
    if (safety.autoDisable.enabled && !this.autoDisabled) {
      const recentExperiments = this.experimentHistory.filter(
        exp => Date.now() - exp.timestamp.getTime() < safety.autoDisable.timeWindow
      );

      if (recentExperiments.length > 0) {
        const errorRate = recentExperiments.filter(exp => !exp.injected).length / recentExperiments.length;

        if (errorRate > safety.autoDisable.errorRateThreshold) {
          this.autoDisabled = true;
          this.safetyTriggered++;

          this.emit('safety_triggered', {
            type: 'auto_disable',
            errorRate,
            threshold: safety.autoDisable.errorRateThreshold
          });

          logger.error('Chaos injection auto-disabled due to high error rate', {
            errorRate,
            threshold: safety.autoDisable.errorRateThreshold
          });
        }
      }
    }
  }
}
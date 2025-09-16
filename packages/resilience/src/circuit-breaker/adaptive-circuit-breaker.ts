import { EventEmitter } from 'eventemitter3';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Circuit Breaker States
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Name identifier for the circuit breaker */
  name: string;

  /** Failure threshold to trip the circuit (percentage) */
  failureThreshold: number;

  /** Minimum number of requests before evaluating threshold */
  minimumRequests: number;

  /** Time to wait before attempting to close circuit (ms) */
  resetTimeout: number;

  /** Maximum time window for failure rate calculation (ms) */
  timeWindow: number;

  /** Adaptive configuration */
  adaptive: {
    /** Enable adaptive threshold adjustment */
    enabled: boolean;

    /** Minimum failure threshold */
    minThreshold: number;

    /** Maximum failure threshold */
    maxThreshold: number;

    /** Adjustment factor for threshold changes */
    adjustmentFactor: number;

    /** Time window for adaptation evaluation (ms) */
    adaptationWindow: number;
  };

  /** Request timeout (ms) */
  requestTimeout: number;

  /** Enable detailed metrics collection */
  metricsEnabled: boolean;
}

/**
 * Request Statistics
 */
interface RequestStats {
  timestamp: number;
  success: boolean;
  duration: number;
  error?: Error;
}

/**
 * Circuit Breaker Metrics
 */
export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitBreakerState;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  averageResponseTime: number;
  currentFailureRate: number;
  currentThreshold: number;
  timesOpened: number;
  timesClosed: number;
  lastStateChange: Date;
  uptime: number;
}

/**
 * Circuit Breaker Exception
 */
export class CircuitBreakerOpenError extends Error {
  constructor(circuitName: string, failureRate: number) {
    super(`Circuit breaker '${circuitName}' is OPEN (failure rate: ${failureRate.toFixed(2)}%)`);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Adaptive Circuit Breaker Implementation
 * Features:
 * - Adaptive failure threshold based on historical performance
 * - Real-time metrics and monitoring
 * - Multiple failure detection strategies
 * - Event emission for monitoring and alerting
 */
export class AdaptiveCircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'closed';
  private readonly config: CircuitBreakerConfig;
  private readonly metrics?: MetricsCollector;

  // Request tracking
  private readonly requestHistory: RequestStats[] = [];
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private rejectedRequests = 0;

  // State management
  private lastStateChange = new Date();
  private timesOpened = 0;
  private timesClosed = 0;
  private nextRetryTime = 0;

  // Adaptive threshold management
  private currentThreshold: number;
  private lastAdaptation = Date.now();
  private adaptationHistory: number[] = [];

  // Performance tracking
  private totalResponseTime = 0;
  private readonly startTime = Date.now();

  constructor(config: CircuitBreakerConfig, metrics?: MetricsCollector) {
    super();
    this.config = config;
    this.metrics = metrics;
    this.currentThreshold = config.failureThreshold;

    // Start periodic cleanup of old request data
    this.startCleanupTimer();

    logger.info('Circuit breaker initialized', {
      name: config.name,
      failureThreshold: config.failureThreshold,
      resetTimeout: config.resetTimeout,
      adaptive: config.adaptive.enabled
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() < this.nextRetryTime) {
        this.rejectedRequests++;
        this.recordMetrics('rejected');

        if (fallback) {
          logger.debug('Circuit breaker open, executing fallback', {
            name: this.config.name,
            nextRetryTime: new Date(this.nextRetryTime)
          });
          return await fallback();
        }

        throw new CircuitBreakerOpenError(this.config.name, this.getCurrentFailureRate());
      } else {
        // Attempt to transition to half-open
        this.transitionToHalfOpen();
      }
    }

    const startTime = Date.now();
    this.totalRequests++;

    try {
      // Apply request timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.requestTimeout);
      });

      const result = await Promise.race([operation(), timeoutPromise]);
      const duration = Date.now() - startTime;

      // Record successful execution
      this.recordSuccess(duration);
      this.evaluateCircuitState();

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed execution
      this.recordFailure(error as Error, duration);
      this.evaluateCircuitState();

      // Try fallback if available
      if (fallback && this.state === 'open') {
        logger.warn('Operation failed, executing fallback', {
          name: this.config.name,
          error: error instanceof Error ? error.message : String(error)
        });
        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Get current circuit breaker metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      name: this.config.name,
      state: this.state,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      rejectedRequests: this.rejectedRequests,
      averageResponseTime: this.getAverageResponseTime(),
      currentFailureRate: this.getCurrentFailureRate(),
      currentThreshold: this.currentThreshold,
      timesOpened: this.timesOpened,
      timesClosed: this.timesClosed,
      lastStateChange: this.lastStateChange,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed';
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.rejectedRequests = 0;
    this.timesOpened = 0;
    this.timesClosed = 0;
    this.totalResponseTime = 0;
    this.requestHistory.length = 0;
    this.adaptationHistory.length = 0;
    this.currentThreshold = this.config.failureThreshold;
    this.lastStateChange = new Date();
    this.nextRetryTime = 0;

    this.emit('reset', { name: this.config.name });
    logger.info('Circuit breaker reset', { name: this.config.name });
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(): void {
    if (this.state !== 'open') {
      this.transitionToOpen();
    }
  }

  /**
   * Force circuit breaker to closed state
   */
  forceClosed(): void {
    if (this.state !== 'closed') {
      this.transitionToClosed();
    }
  }

  // Private methods

  private recordSuccess(duration: number): void {
    this.successfulRequests++;
    this.totalResponseTime += duration;

    this.requestHistory.push({
      timestamp: Date.now(),
      success: true,
      duration
    });

    this.recordMetrics('success', duration);
  }

  private recordFailure(error: Error, duration: number): void {
    this.failedRequests++;
    this.totalResponseTime += duration;

    this.requestHistory.push({
      timestamp: Date.now(),
      success: false,
      duration,
      error
    });

    this.recordMetrics('failure', duration);
  }

  private evaluateCircuitState(): void {
    const recentRequests = this.getRecentRequests();

    if (recentRequests.length < this.config.minimumRequests) {
      return; // Not enough data to make a decision
    }

    const failureRate = this.getCurrentFailureRate();

    // Adapt threshold if enabled
    if (this.config.adaptive.enabled) {
      this.adaptThreshold();
    }

    switch (this.state) {
      case 'closed':
        if (failureRate >= this.currentThreshold) {
          this.transitionToOpen();
        }
        break;

      case 'half-open':
        // In half-open state, a single failure opens the circuit again
        if (this.requestHistory[this.requestHistory.length - 1]?.success === false) {
          this.transitionToOpen();
        } else if (recentRequests.length >= 5 && failureRate < this.currentThreshold) {
          // Close if we have enough successful requests
          this.transitionToClosed();
        }
        break;
    }
  }

  private transitionToOpen(): void {
    this.state = 'open';
    this.timesOpened++;
    this.lastStateChange = new Date();
    this.nextRetryTime = Date.now() + this.config.resetTimeout;

    this.emit('open', {
      name: this.config.name,
      failureRate: this.getCurrentFailureRate(),
      threshold: this.currentThreshold
    });

    logger.warn('Circuit breaker opened', {
      name: this.config.name,
      failureRate: this.getCurrentFailureRate(),
      threshold: this.currentThreshold,
      nextRetryTime: new Date(this.nextRetryTime)
    });
  }

  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.lastStateChange = new Date();

    this.emit('half-open', { name: this.config.name });

    logger.info('Circuit breaker transitioned to half-open', {
      name: this.config.name
    });
  }

  private transitionToClosed(): void {
    this.state = 'closed';
    this.timesClosed++;
    this.lastStateChange = new Date();

    this.emit('closed', { name: this.config.name });

    logger.info('Circuit breaker closed', {
      name: this.config.name,
      failureRate: this.getCurrentFailureRate()
    });
  }

  private getCurrentFailureRate(): number {
    const recentRequests = this.getRecentRequests();
    if (recentRequests.length === 0) return 0;

    const failures = recentRequests.filter(req => !req.success).length;
    return (failures / recentRequests.length) * 100;
  }

  private getRecentRequests(): RequestStats[] {
    const cutoff = Date.now() - this.config.timeWindow;
    return this.requestHistory.filter(req => req.timestamp > cutoff);
  }

  private getAverageResponseTime(): number {
    if (this.totalRequests === 0) return 0;
    return this.totalResponseTime / this.totalRequests;
  }

  private adaptThreshold(): void {
    const now = Date.now();
    if (now - this.lastAdaptation < this.config.adaptive.adaptationWindow) {
      return; // Too soon to adapt
    }

    const recentRequests = this.getRecentRequests();
    if (recentRequests.length < this.config.minimumRequests * 2) {
      return; // Not enough data for adaptation
    }

    const failureRate = this.getCurrentFailureRate();
    const { minThreshold, maxThreshold, adjustmentFactor } = this.config.adaptive;

    // Record current performance for trend analysis
    this.adaptationHistory.push(failureRate);
    if (this.adaptationHistory.length > 10) {
      this.adaptationHistory.shift();
    }

    // Calculate trend
    const trend = this.calculateTrend();

    if (trend > 0 && failureRate < this.currentThreshold * 0.8) {
      // Performance is improving, slightly increase threshold
      this.currentThreshold = Math.min(
        maxThreshold,
        this.currentThreshold + adjustmentFactor
      );
    } else if (trend < 0 && failureRate > this.currentThreshold * 0.6) {
      // Performance is degrading, decrease threshold
      this.currentThreshold = Math.max(
        minThreshold,
        this.currentThreshold - adjustmentFactor
      );
    }

    this.lastAdaptation = now;

    logger.debug('Threshold adapted', {
      name: this.config.name,
      oldThreshold: this.config.failureThreshold,
      newThreshold: this.currentThreshold,
      failureRate,
      trend
    });
  }

  private calculateTrend(): number {
    if (this.adaptationHistory.length < 3) return 0;

    const recent = this.adaptationHistory.slice(-3);
    const older = this.adaptationHistory.slice(-6, -3);

    if (older.length === 0) return 0;

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

    return recentAvg - olderAvg;
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      const cutoff = Date.now() - this.config.timeWindow * 2;
      const originalLength = this.requestHistory.length;

      // Remove old requests
      while (this.requestHistory.length > 0 && this.requestHistory[0].timestamp < cutoff) {
        this.requestHistory.shift();
      }

      if (originalLength !== this.requestHistory.length) {
        logger.debug('Cleaned up old request history', {
          name: this.config.name,
          removed: originalLength - this.requestHistory.length,
          remaining: this.requestHistory.length
        });
      }
    }, this.config.timeWindow);
  }

  private recordMetrics(type: 'success' | 'failure' | 'rejected', duration?: number): void {
    if (!this.config.metricsEnabled || !this.metrics) return;

    this.metrics.recordCustomMetric(
      'circuit_breaker_requests_total',
      1,
      {
        name: this.config.name,
        type,
        state: this.state
      },
      'counter'
    );

    if (duration !== undefined) {
      this.metrics.recordCustomMetric(
        'circuit_breaker_request_duration_ms',
        duration,
        {
          name: this.config.name,
          type,
          state: this.state
        },
        'histogram'
      );
    }

    this.metrics.recordCustomMetric(
      'circuit_breaker_failure_rate',
      this.getCurrentFailureRate(),
      {
        name: this.config.name
      },
      'gauge'
    );
  }
}
import { logger } from '@discord-bot/logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  timeout: number;
  monitoringWindow: number;
  volumeThreshold: number;
}

export interface CircuitBreakerMetrics {
  failures: number;
  successes: number;
  requests: number;
  state: CircuitState;
  lastFailureTime?: number;
  stateChangeTime: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private requests = 0;
  private lastFailureTime?: number;
  private stateChangeTime = Date.now();
  private requestWindow: number[] = [];

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.stateChangeTime = Date.now();
        logger.info({ circuit: this.name }, 'Circuit breaker transitioning to HALF_OPEN');
      } else {
        logger.debug({ circuit: this.name }, 'Circuit breaker is OPEN, executing fallback');
        if (fallback) {
          return await fallback();
        }
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    this.trackRequest();

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();

      if (fallback) {
        logger.warn({
          circuit: this.name,
          error: error instanceof Error ? error.message : String(error)
        }, 'Circuit breaker executing fallback after failure');
        return await fallback();
      }

      throw error;
    }
  }

  private trackRequest(): void {
    const now = Date.now();
    this.requests++;
    this.requestWindow.push(now);

    // Clean old requests outside monitoring window
    const cutoff = now - this.config.monitoringWindow;
    this.requestWindow = this.requestWindow.filter(timestamp => timestamp > cutoff);
  }

  private onSuccess(): void {
    this.successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.stateChangeTime = Date.now();
      this.failures = 0;
      logger.info({ circuit: this.name }, 'Circuit breaker reset to CLOSED after successful request');
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.shouldOpen()) {
      this.state = CircuitState.OPEN;
      this.stateChangeTime = Date.now();
      logger.error({
        circuit: this.name,
        failures: this.failures,
        requests: this.requestWindow.length,
        failureRate: this.getFailureRate()
      }, 'Circuit breaker opened due to failure threshold');
    }
  }

  private shouldOpen(): boolean {
    if (this.requestWindow.length < this.config.volumeThreshold) {
      return false;
    }

    return this.getFailureRate() >= this.config.failureThreshold;
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  private getFailureRate(): number {
    const totalRequests = this.requestWindow.length;
    if (totalRequests === 0) return 0;

    const failuresInWindow = this.failures;
    return failuresInWindow / totalRequests;
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      state: this.state,
      lastFailureTime: this.lastFailureTime,
      stateChangeTime: this.stateChangeTime
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.requests = 0;
    this.lastFailureTime = undefined;
    this.stateChangeTime = Date.now();
    this.requestWindow = [];

    logger.info({ circuit: this.name }, 'Circuit breaker manually reset');
  }
}

export class CircuitBreakerManager {
  private static instance: CircuitBreakerManager;
  private circuits = new Map<string, CircuitBreaker>();

  static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  getCircuit(name: string, config: CircuitBreakerConfig): CircuitBreaker {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, new CircuitBreaker(name, config));
    }
    return this.circuits.get(name)!;
  }

  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const metrics: Record<string, CircuitBreakerMetrics> = {};
    for (const [name, circuit] of this.circuits) {
      metrics[name] = circuit.getMetrics();
    }
    return metrics;
  }

  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
    logger.info('All circuit breakers reset');
  }
}
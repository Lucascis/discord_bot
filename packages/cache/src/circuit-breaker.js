import { logger } from '@discord-bot/logger';
export var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (CircuitState = {}));
export class CircuitBreaker {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.requests = 0;
        this.stateChangeTime = Date.now();
        this.requestWindow = [];
    }
    async execute(operation, fallback) {
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.state = CircuitState.HALF_OPEN;
                this.stateChangeTime = Date.now();
                logger.info({ circuit: this.name }, 'Circuit breaker transitioning to HALF_OPEN');
            }
            else {
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
        }
        catch (error) {
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
    trackRequest() {
        const now = Date.now();
        this.requests++;
        this.requestWindow.push(now);
        // Clean old requests outside monitoring window
        const cutoff = now - this.config.monitoringWindow;
        this.requestWindow = this.requestWindow.filter(timestamp => timestamp > cutoff);
    }
    onSuccess() {
        this.successes++;
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.CLOSED;
            this.stateChangeTime = Date.now();
            this.failures = 0;
            logger.info({ circuit: this.name }, 'Circuit breaker reset to CLOSED after successful request');
        }
    }
    onFailure() {
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
    shouldOpen() {
        if (this.requestWindow.length < this.config.volumeThreshold) {
            return false;
        }
        return this.getFailureRate() >= this.config.failureThreshold;
    }
    shouldAttemptReset() {
        if (!this.lastFailureTime)
            return false;
        return Date.now() - this.lastFailureTime >= this.config.timeout;
    }
    getFailureRate() {
        const totalRequests = this.requestWindow.length;
        if (totalRequests === 0)
            return 0;
        const failuresInWindow = this.failures;
        return failuresInWindow / totalRequests;
    }
    getMetrics() {
        return {
            failures: this.failures,
            successes: this.successes,
            requests: this.requests,
            state: this.state,
            lastFailureTime: this.lastFailureTime,
            stateChangeTime: this.stateChangeTime
        };
    }
    reset() {
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
    constructor() {
        this.circuits = new Map();
    }
    static getInstance() {
        if (!CircuitBreakerManager.instance) {
            CircuitBreakerManager.instance = new CircuitBreakerManager();
        }
        return CircuitBreakerManager.instance;
    }
    getCircuit(name, config) {
        if (!this.circuits.has(name)) {
            this.circuits.set(name, new CircuitBreaker(name, config));
        }
        return this.circuits.get(name);
    }
    getAllMetrics() {
        const metrics = {};
        for (const [name, circuit] of this.circuits) {
            metrics[name] = circuit.getMetrics();
        }
        return metrics;
    }
    resetAll() {
        for (const circuit of this.circuits.values()) {
            circuit.reset();
        }
        logger.info('All circuit breakers reset');
    }
}

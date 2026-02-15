export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
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
export declare class CircuitBreaker {
    private readonly name;
    private readonly config;
    private state;
    private failures;
    private successes;
    private requests;
    private lastFailureTime?;
    private stateChangeTime;
    private requestWindow;
    constructor(name: string, config: CircuitBreakerConfig);
    execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T> | T): Promise<T>;
    private trackRequest;
    private onSuccess;
    private onFailure;
    private shouldOpen;
    private shouldAttemptReset;
    private getFailureRate;
    getMetrics(): CircuitBreakerMetrics;
    reset(): void;
}
export declare class CircuitBreakerManager {
    private static instance;
    private circuits;
    static getInstance(): CircuitBreakerManager;
    getCircuit(name: string, config: CircuitBreakerConfig): CircuitBreaker;
    getAllMetrics(): Record<string, CircuitBreakerMetrics>;
    resetAll(): void;
}
//# sourceMappingURL=circuit-breaker.d.ts.map
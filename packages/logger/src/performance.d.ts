import { EventEmitter } from 'events';
export interface PerformanceMetrics {
    memory: {
        heapUsed: number;
        heapTotal: number;
        external: number;
        rss: number;
        heapUtilization: number;
    };
    cpu: {
        loadAverage: number[];
        processUptime: number;
    };
    gc: {
        collections: number;
        totalDuration: number;
        averageDuration: number;
    };
    eventLoop: {
        lag: number;
        delay: number;
    };
}
export declare class PerformanceMonitor extends EventEmitter {
    private monitoringInterval;
    private gcStats;
    private eventLoopStart;
    private intervalId;
    constructor(monitoringInterval?: number);
    start(): void;
    stop(): void;
    collectMetrics(): PerformanceMetrics;
    private setupGCMonitoring;
    createMemoryLeakDetector(thresholdMB?: number, samplesCount?: number): void;
    private calculateTrend;
    static createConnectionPoolMonitor(poolName: string, getPoolStats: () => any): void;
}
export declare const performanceMonitor: PerformanceMonitor;
//# sourceMappingURL=performance.d.ts.map
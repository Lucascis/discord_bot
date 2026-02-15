import type { HealthCheckResult } from './health.js';
export interface AdvancedHealthConfig {
    timeout: number;
    retryAttempts: number;
    warningThresholds: {
        responseTime: number;
        memoryUsage: number;
        cpuUsage: number;
    };
    criticalThresholds: {
        responseTime: number;
        memoryUsage: number;
        cpuUsage: number;
    };
}
export interface ComponentHealth {
    component: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime: number;
    details: Record<string, unknown>;
    lastChecked: string;
    consecutiveFailures: number;
}
export interface SystemMetrics {
    memory: {
        used: number;
        total: number;
        percentage: number;
        heap: {
            used: number;
            total: number;
            percentage: number;
        };
    };
    cpu: {
        percentage: number;
        loadAverage: number[];
    };
    uptime: number;
    gc: {
        collections: number;
        duration: number;
    };
}
/**
 * Advanced health monitoring with detailed system metrics and component tracking
 */
export declare class AdvancedHealthMonitor {
    private components;
    private config;
    private lastGCMetrics;
    private healthHistory;
    private maxHistoryLength;
    constructor(config?: Partial<AdvancedHealthConfig>);
    /**
     * Register a component for health monitoring
     */
    registerComponent(name: string, _healthCheck: () => Promise<HealthCheckResult>): void;
    /**
     * Check health of a specific component with retry logic
     */
    checkComponent(name: string, healthCheck: () => Promise<HealthCheckResult>): Promise<ComponentHealth>;
    /**
     * Check health of all registered components
     */
    checkAllComponents(healthChecks: Map<string, () => Promise<HealthCheckResult>>): Promise<Map<string, ComponentHealth>>;
    /**
     * Get comprehensive system metrics
     */
    getSystemMetrics(): SystemMetrics;
    /**
     * Get health summary with system context
     */
    getHealthSummary(): {
        overall: 'healthy' | 'degraded' | 'unhealthy';
        components: ComponentHealth[];
        systemMetrics: SystemMetrics;
        alerts: Array<{
            type: 'warning' | 'critical';
            message: string;
            component?: string;
        }>;
    };
    /**
     * Get health trends for a specific component
     */
    getComponentTrends(componentName: string, minutes?: number): {
        component: string;
        trends: {
            averageResponseTime: number;
            successRate: number;
            recentFailures: number;
        };
        history: HealthCheckResult[];
    };
    private determineStatus;
    private addToHistory;
    private initializeGCMonitoring;
    private getCPUUsage;
    private getGCMetrics;
    private delay;
}
export declare function getAdvancedHealthMonitor(config?: Partial<AdvancedHealthConfig>): AdvancedHealthMonitor;
//# sourceMappingURL=advanced-health.d.ts.map
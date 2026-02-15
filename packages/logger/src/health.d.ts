export interface HealthCheckResult {
    status: 'healthy' | 'unhealthy' | 'degraded';
    message?: string;
    responseTime?: number;
    details?: Record<string, unknown>;
}
interface DatabaseClient {
    $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}
interface RedisClient {
    ping(): Promise<string>;
}
interface DiscordClientStatus {
    isReady(): boolean;
    readyTimestamp: number | null;
    user?: {
        tag: string;
    } | null;
    guilds: {
        cache: {
            size: number;
        };
    };
    users: {
        cache: {
            size: number;
        };
    };
    ws: {
        ping: number;
    };
}
interface LavalinkManager {
    nodeManager?: {
        nodes: Map<string, LavalinkNode>;
    };
}
interface LavalinkNode {
    id: string;
    connected: boolean;
    stats?: {
        cpu?: {
            systemLoad: number;
            lavalinkLoad: number;
        };
    };
}
export interface ServiceHealth {
    service: string;
    status: 'healthy' | 'unhealthy' | 'degraded';
    uptime: number;
    timestamp: string;
    version: string;
    checks: Record<string, HealthCheckResult>;
    overall: HealthCheckResult;
}
/**
 * Health check manager for services
 */
export declare class HealthChecker {
    private serviceName;
    private version;
    private checks;
    private startTime;
    constructor(serviceName: string, version?: string);
    /**
     * Register a health check
     */
    register(name: string, check: () => Promise<HealthCheckResult>): void;
    /**
     * Run all health checks and return overall status
     */
    check(): Promise<ServiceHealth>;
    private calculateOverallStatus;
}
/**
 * Common health check functions
 */
export declare const CommonHealthChecks: {
    /**
     * Database connectivity check
     */
    database(prisma: DatabaseClient): Promise<HealthCheckResult>;
    /**
     * Redis connectivity check
     */
    redis(client: RedisClient): Promise<HealthCheckResult>;
    /**
     * Discord bot readiness check
     */
    discordBot(client: DiscordClientStatus): Promise<HealthCheckResult>;
    /**
     * Lavalink nodes health check
     */
    lavalink(manager: LavalinkManager): Promise<HealthCheckResult>;
    /**
     * Memory usage check
     */
    memory(maxMemoryMB?: number): Promise<HealthCheckResult>;
};
export {};
//# sourceMappingURL=health.d.ts.map
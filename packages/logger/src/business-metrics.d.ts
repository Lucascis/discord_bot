import { Registry } from 'prom-client';
export interface BusinessMetrics {
    activeUsers: number;
    dailyActiveUsers: Set<string>;
    monthlyActiveUsers: Set<string>;
    userRetention: number;
    songsPlayed: number;
    totalPlaytime: number;
    averageSessionDuration: number;
    peakConcurrentListeners: number;
    averageQueueLength: number;
    queueCompletionRate: number;
    skipRate: number;
    searchQueries: number;
    searchSuccessRate: number;
    popularSearchTerms: Map<string, number>;
    sourceDistribution: Map<string, number>;
    autoplayEngagementRate: number;
    autoplaySkipRate: number;
    autoplaySuccessRate: number;
    errorRate: number;
    commandSuccessRate: number;
    averageResponseTime: number;
    featureUsage: Map<string, number>;
    commandUsage: Map<string, number>;
}
/**
 * Business metrics collector for data-driven decisions
 */
export declare class BusinessMetricsCollector {
    private registry;
    private metrics;
    private aggregations;
    constructor(_registry?: Registry);
    private initializeMetrics;
    trackUserActivity(userId: string, guildId: string): void;
    trackSessionStart(userId: string, guildId: string): void;
    trackSessionEnd(userId: string, guildId: string): void;
    trackSongPlay(guildId: string, track: {
        title: string;
        duration: number;
        source?: string;
    }, isAutoplay?: boolean): void;
    trackSongSkip(guildId: string, track: {
        title?: string;
        duration: number;
    }, playedDuration: number, reason: 'user_skip' | 'autoplay_skip' | 'error_skip' | 'queue_advance', userId?: string): void;
    trackQueueOperation(guildId: string, operation: 'add' | 'remove' | 'clear' | 'shuffle', queueLength: number, userId?: string): void;
    trackSearch(guildId: string, query: string, source: string, resultCount: number, latency: number, cached?: boolean): void;
    trackAutoplayTrigger(guildId: string, triggerType: 'queue_empty' | 'user_request', userId?: string): void;
    trackAutoplayRecommendation(guildId: string, recommendationType: 'similar' | 'artist' | 'genre' | 'mixed', success: boolean, trackTitle?: string, userId?: string): void;
    trackAutoplaySkip(guildId: string, reason: string): void;
    trackCommand(command: string, guildId: string, latency: number, success: boolean, errorType?: string): void;
    trackFeatureUsage(feature: string, guildId: string): void;
    trackSearchQuery(guildId: string, query: string, source: string, resultCount: number, latency: number, cached?: boolean, userId?: string): void;
    trackCommandExecution(command: string, guildId: string, latency: number, success: boolean, errorType?: string, userId?: string): void;
    getBusinessInsights(): {
        timestamp: string;
        engagement: {
            dau: number;
            mau: number;
            avgSessionDuration: number;
            retentionRate: number;
        };
        usage: {
            totalSongsPlayed: number;
            topSearchTerms: Array<{
                term: string;
                count: number;
            }>;
            topTracks: Array<{
                title: string;
                plays: number;
            }>;
            sourceDistribution: Record<string, number>;
        };
        performance: {
            searchSuccessRate: number;
            commandSuccessRate: number;
            autoplayEngagement: number;
        };
        guilds: {
            activeGuilds: number;
            topGuilds: Array<{
                guildId: string;
                commands: number;
            }>;
        };
    };
    getMetrics(): Promise<string>;
    private startAggregationJobs;
    private updateEngagementMetrics;
}
export declare function getBusinessMetrics(registry?: Registry): BusinessMetricsCollector;
export declare function resetBusinessMetrics(): void;
//# sourceMappingURL=business-metrics.d.ts.map
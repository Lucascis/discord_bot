import { apiFetch } from './api-client';

export interface DashboardMetrics {
  overview: {
    totalGuilds: number;
    activeGuilds: number;
    totalUsers: number;
    totalTracks: number;
    totalPlaytime: number;
  };
  performance: {
    uptime: number;
    responseTime: number;
    errorRate: number;
  };
  activity: {
    commandsToday: number;
    tracksToday: number;
    peakConcurrentUsers: number;
  };
  growth: {
    newGuildsThisWeek: number;
    newUsersThisWeek: number;
    retentionRate: number;
  };
}

export interface GuildAnalytics {
  guildId: string;
  period: 'day' | 'week' | 'month' | 'year';
  metrics: {
    totalTracks: number;
    totalPlaytime: number;
    uniqueUsers: number;
    commandsUsed: number;
    popularTracks: Array<{
      track: {
        identifier: string;
        title: string;
        author: string;
        uri: string;
        length: number;
      };
      playCount: number;
    }>;
    userActivity: Array<{
      userId: string;
      username: string;
      tracksAdded: number;
      commandsUsed: number;
    }>;
  };
}

export async function getAnalyticsOverview(apiKey?: string): Promise<DashboardMetrics | null> {
  try {
    return await apiFetch<DashboardMetrics>('/api/v1/analytics/dashboard', { apiKey });
  } catch {
    return null;
  }
}

export async function getGuildAnalytics(
  guildId: string,
  period: string = 'week',
  apiKey?: string
): Promise<GuildAnalytics | null> {
  if (!guildId) return null;
  try {
    return await apiFetch<GuildAnalytics>(`/api/v1/analytics/guilds/${guildId}?period=${period}`, { apiKey });
  } catch {
    return null;
  }
}

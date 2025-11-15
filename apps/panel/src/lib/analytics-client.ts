import { apiFetch } from './api-client';

export type GuildAnalytics = {
  guildId: string;
  period: 'day' | 'week' | 'month' | 'year';
  metrics: {
    totalTracks: number;
    totalPlaytime: number;
    uniqueUsers: number;
    commandsUsed: number;
    popularTracks: Array<{
      track: {
        title: string;
        author: string;
        uri: string;
        identifier: string;
        duration: number;
        source: string;
      };
      playCount: number;
    }>;
    userActivity: Array<{ userId: string; count: number }>;
  };
};

export async function getGuildAnalytics(guildId: string): Promise<GuildAnalytics | null> {
  try {
    return await apiFetch<GuildAnalytics>(`/api/v1/analytics/guilds/${guildId}`);
  } catch {
    return null;
  }
}

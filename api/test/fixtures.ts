import type { Guild, Track, Queue, GuildSettings, SearchResult } from '../src/types/api.js';

/**
 * Test fixtures for API tests
 */

export const mockGuild: Guild = {
  id: '123456789012345678',
  name: 'Test Guild',
  icon: 'test-icon-hash',
  memberCount: 100,
  available: true
};

export const mockTrack: Track = {
  title: 'Test Track',
  author: 'Test Artist',
  uri: 'https://youtube.com/watch?v=test',
  identifier: 'test-id-123',
  duration: 240000,
  isSeekable: true,
  isStream: false,
  position: 0,
  thumbnail: 'https://i.ytimg.com/vi/test/default.jpg',
  source: 'youtube',
  requester: {
    id: '987654321098765432',
    username: 'TestUser'
  }
};

export const mockQueue: Queue = {
  guildId: '123456789012345678',
  tracks: [mockTrack],
  currentTrack: mockTrack,
  position: 0,
  duration: 240000,
  size: 1,
  empty: false
};

export const mockGuildSettings: GuildSettings = {
  guildId: '123456789012345678',
  defaultVolume: 50,
  autoplay: false,
  djRoleId: '111222333444555666',
  maxQueueSize: 100,
  allowExplicitContent: true,
  defaultSearchSource: 'youtube',
  announceNowPlaying: true,
  deleteInvokeMessage: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

export const mockSearchResult: SearchResult = {
  tracks: [mockTrack],
  source: 'youtube',
  query: 'test query',
  totalResults: 1
};

export const mockDashboardMetrics = {
  overview: {
    totalGuilds: 100,
    activeGuilds: 75,
    totalUsers: 5000,
    totalTracks: 10000,
    totalPlaytime: 1000000
  },
  performance: {
    uptime: 86400,
    responseTime: 50,
    errorRate: 0.5
  },
  activity: {
    commandsToday: 1000,
    tracksToday: 500,
    peakConcurrentUsers: 200
  },
  growth: {
    newGuildsThisWeek: 10,
    newUsersThisWeek: 50,
    retentionRate: 85
  }
};

export const mockGuildAnalytics = {
  guildId: '123456789012345678',
  period: 'week' as const,
  metrics: {
    totalTracks: 100,
    totalPlaytime: 100000,
    uniqueUsers: 25,
    commandsUsed: 200,
    popularTracks: [
      {
        track: {
          title: 'Popular Track',
          author: 'Popular Artist',
          uri: 'https://youtube.com/watch?v=popular',
          identifier: 'popular-123',
          duration: 180000,
          isSeekable: true,
          isStream: false,
          thumbnail: 'https://i.ytimg.com/vi/popular/default.jpg',
          source: 'youtube' as const
        },
        playCount: 50
      }
    ],
    userActivity: [
      {
        userId: '987654321098765432',
        username: 'ActiveUser',
        tracksAdded: 20,
        commandsUsed: 40
      }
    ]
  }
};

export const validGuildId = '123456789012345678';
export const invalidGuildId = 'invalid-id';
export const validApiKey = 'test-api-key-12345678901234567890123456789012';
export const invalidApiKey = 'invalid-key';

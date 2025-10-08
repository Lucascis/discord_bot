/**
 * API Type Definitions
 *
 * Comprehensive type definitions for the Discord Music Bot REST API
 * Following OpenAPI 3.1 and Discord API conventions
 */

// ===== COMMON TYPES =====

export interface APIResponse<T = unknown> {
  data: T;
  timestamp: string;
  requestId?: string;
}

export interface PaginatedResponse<T = unknown> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    timestamp: string;
    requestId?: string;
    details?: unknown;
  };
}

// ===== DISCORD TYPES =====

// Discord Snowflake ID
export type Snowflake = string;

// Basic Discord Guild information
export interface Guild {
  id: Snowflake;
  name: string;
  icon?: string;
  memberCount?: number;
  available: boolean;
}

// Discord User information
export interface User {
  id: Snowflake;
  username: string;
  discriminator: string;
  avatar?: string;
  bot: boolean;
}

// Discord Channel information
export interface Channel {
  id: Snowflake;
  name: string;
  type: number;
  guildId: Snowflake;
}

// ===== MUSIC TYPES =====

// Track information
export interface Track {
  title: string;
  author: string;
  uri: string;
  identifier: string;
  duration: number;
  isSeekable: boolean;
  isStream: boolean;
  position?: number;
  thumbnail?: string;
  source: 'youtube' | 'spotify' | 'soundcloud' | 'bandcamp' | 'twitch' | 'vimeo' | 'http';
  requester?: {
    id: Snowflake;
    username: string;
  };
}

// Queue information
export interface Queue {
  guildId: Snowflake;
  tracks: Track[];
  currentTrack?: Track;
  position: number;
  duration: number;
  size: number;
  empty: boolean;
}

// Player state
export interface PlayerState {
  guildId: Snowflake;
  voiceChannelId?: Snowflake;
  textChannelId?: Snowflake;
  connected: boolean;
  playing: boolean;
  paused: boolean;
  position: number;
  volume: number;
  filters: Record<string, unknown>;
}

// ===== GUILD SETTINGS TYPES =====

export interface GuildSettings {
  guildId: Snowflake;
  defaultVolume: number;
  autoplay: boolean;
  djRoleId?: Snowflake;
  maxQueueSize: number;
  allowExplicitContent: boolean;
  defaultSearchSource: 'youtube' | 'spotify' | 'soundcloud';
  announceNowPlaying: boolean;
  deleteInvokeMessage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateGuildSettingsRequest {
  defaultVolume?: number;
  autoplay?: boolean;
  djRoleId?: Snowflake;
  maxQueueSize?: number;
  allowExplicitContent?: boolean;
  defaultSearchSource?: 'youtube' | 'spotify' | 'soundcloud';
  announceNowPlaying?: boolean;
  deleteInvokeMessage?: boolean;
}

// ===== SEARCH TYPES =====

export interface SearchResult {
  tracks: Track[];
  playlistInfo?: {
    name: string;
    author: string;
    uri: string;
    trackCount: number;
  };
  source: string;
  query: string;
  totalResults: number;
}

export interface SearchRequest {
  q: string;
  source?: 'youtube' | 'spotify' | 'soundcloud' | 'all';
  limit?: number;
  page?: number;
}

// ===== QUEUE OPERATIONS =====

export interface AddTrackRequest {
  query: string;
  position?: number;
  source?: 'youtube' | 'spotify' | 'soundcloud';
}

export interface AddTrackResponse {
  track: Track;
  position: number;
  queue: Queue;
}

export interface RemoveTrackRequest {
  position: number;
}

export interface RemoveTrackResponse {
  removedTrack: Track;
  queue: Queue;
}

// ===== ANALYTICS TYPES =====

export interface GuildAnalytics {
  guildId: Snowflake;
  period: 'day' | 'week' | 'month' | 'year';
  metrics: {
    totalTracks: number;
    totalPlaytime: number; // in seconds
    uniqueUsers: number;
    commandsUsed: number;
    popularTracks: Array<{
      track: Omit<Track, 'requester'>;
      playCount: number;
    }>;
    userActivity: Array<{
      userId: Snowflake;
      username: string;
      tracksAdded: number;
      commandsUsed: number;
    }>;
  };
}

export interface GlobalAnalytics {
  period: 'day' | 'week' | 'month' | 'year';
  metrics: {
    totalGuilds: number;
    activeGuilds: number;
    totalUsers: number;
    activeUsers: number;
    totalTracks: number;
    totalPlaytime: number;
    commandsPerMinute: number;
    topGuilds: Array<{
      guildId: Snowflake;
      guildName: string;
      activity: number;
    }>;
  };
}

// ===== WEBHOOK TYPES =====

export interface DiscordWebhookRequest {
  type: number;
  data?: {
    id?: Snowflake;
    name?: string;
    options?: Array<{
      name: string;
      value: string | number | boolean;
    }>;
  };
  guild_id?: Snowflake;
  channel_id?: Snowflake;
  member?: {
    user: User;
    roles: Snowflake[];
  };
  token: string;
}

// ===== API VERSION TYPES =====

export interface APIVersion {
  version: string;
  releaseDate: string;
  deprecated: boolean;
  deprecationDate?: string;
  endpoints: string[];
  features: string[];
  changelog: string[];
}

// ===== HEALTH CHECK TYPES =====

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    discord: ServiceHealth;
    lavalink: ServiceHealth;
  };
  metrics: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
    requests: {
      total: number;
      errors: number;
      averageResponseTime: number;
    };
  };
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: string;
  error?: string;
}

// ===== REQUEST CONTEXT =====

export interface RequestContext {
  requestId: string;
  startTime: number;
  userAgent?: string;
  ip: string;
  authenticated: boolean;
  apiKey?: string;
  guildId?: Snowflake;
}

// ===== WEBHOOK TYPES =====

export interface WebhookPayload {
  guildId: Snowflake;
  userId?: Snowflake;
  channelId?: Snowflake;
  query?: string;
  action?: string;
  message?: string;
  type?: string;
  webhookUrl?: string;
  events?: string[];
}

export interface WebhookResponse {
  success: boolean;
  message: string;
  event: string;
  guildId: Snowflake;
  action?: string;
  webhookUrl?: string;
  events?: string[];
}

export interface WebhookEvent {
  event: string;
  guildId: Snowflake;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ===== ANALYTICS TYPES =====

export interface DashboardMetrics {
  overview: {
    totalGuilds: number;
    activeGuilds: number;
    totalUsers: number;
    totalTracks: number;
    totalPlaytime: number; // in seconds
  };
  performance: {
    uptime: number; // in seconds
    responseTime: number; // average in ms
    errorRate: number; // percentage
  };
  activity: {
    commandsToday: number;
    tracksToday: number;
    peakConcurrentUsers: number;
  };
  growth: {
    newGuildsThisWeek: number;
    newUsersThisWeek: number;
    retentionRate: number; // percentage
  };
}

export interface AnalyticsQuery {
  period: 'day' | 'week' | 'month' | 'year';
  metric?: string;
  guildId?: Snowflake;
  limit?: number;
  page?: number;
}
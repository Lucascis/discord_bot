/**
 * Advanced Playlist System - Types
 * Professional playlist management for Discord Music Bot
 */

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  thumbnail?: string;
  source: 'youtube' | 'spotify' | 'soundcloud' | 'deezer' | 'apple_music';
  addedBy?: string;
  addedAt: Date;
  metadata?: {
    album?: string;
    genre?: string;
    year?: number;
    isrc?: string;
    bpm?: number;
    key?: string;
    energy?: number;
    danceability?: number;
    valence?: number;
  };
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  guildId: string;
  ownerId: string;
  isPublic: boolean;
  isCollaborative: boolean;
  tracks: Track[];
  tags: string[];
  category: PlaylistCategory;
  settings: PlaylistSettings;
  analytics: PlaylistAnalytics;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistSettings {
  autoShuffle: boolean;
  crossfadeEnabled: boolean;
  smartQueue: boolean;
  repeatMode: 'none' | 'track' | 'playlist';
  allowDuplicates: boolean;
  maxTracks?: number;
  moderationEnabled: boolean;
  allowedRoles?: string[];
  bannedWords: string[];
}

export interface PlaylistAnalytics {
  totalPlays: number;
  totalDuration: number;
  averageTrackRating: number;
  mostPlayedTrack?: string;
  skipRate: number;
  completionRate: number;
  lastPlayed?: Date;
  popularityScore: number;
  genreDistribution: Record<string, number>;
  moodProfile: {
    energy: number;
    valence: number;
    danceability: number;
  };
}

export enum PlaylistCategory {
  PERSONAL = 'personal',
  SHARED = 'shared',
  GUILD_FEATURED = 'guild_featured',
  COMMUNITY = 'community',
  CURATED = 'curated',
  MOOD_BASED = 'mood_based',
  GENRE_BASED = 'genre_based',
  ACTIVITY_BASED = 'activity_based'
}

export interface SmartPlaylistCriteria {
  genres?: string[];
  moods?: string[];
  bpmRange?: { min: number; max: number };
  energyRange?: { min: number; max: number };
  valenceRange?: { min: number; max: number };
  yearRange?: { min: number; max: number };
  durationRange?: { min: number; max: number };
  artists?: string[];
  excludeArtists?: string[];
  tags?: string[];
  minRating?: number;
  recentlyPlayed?: boolean;
  excludeRecentlyPlayed?: boolean;
  maxTracks: number;
}

export interface PlaylistRecommendation {
  playlist: Playlist;
  score: number;
  reason: string;
  similarTracks: number;
  sharedTags: string[];
  moodMatch: number;
}

export interface PlaylistCollaboration {
  userId: string;
  role: 'viewer' | 'contributor' | 'moderator' | 'admin';
  permissions: {
    canAddTracks: boolean;
    canRemoveTracks: boolean;
    canReorderTracks: boolean;
    canEditMetadata: boolean;
    canInviteOthers: boolean;
    canModerate: boolean;
  };
  addedAt: Date;
}

export interface PlaylistImportRequest {
  source: 'spotify' | 'youtube' | 'apple_music' | 'deezer' | 'soundcloud' | 'file';
  url?: string;
  data?: any;
  options: {
    preserveOrder: boolean;
    skipUnavailable: boolean;
    mergeWithExisting?: string; // playlist ID
    autoTag: boolean;
    makePublic: boolean;
  };
}

export interface PlaylistExportFormat {
  format: 'm3u8' | 'json' | 'csv' | 'txt' | 'spotify_uri';
  includeMetadata: boolean;
  includeAnalytics: boolean;
  flattenCollaborative: boolean;
}

export interface PlaylistSearchFilter {
  query?: string;
  category?: PlaylistCategory;
  tags?: string[];
  owner?: string;
  isPublic?: boolean;
  isCollaborative?: boolean;
  hasMinTracks?: number;
  createdAfter?: Date;
  updatedAfter?: Date;
  minPopularity?: number;
  genres?: string[];
  moods?: string[];
  sortBy: 'name' | 'created' | 'updated' | 'popularity' | 'duration' | 'tracks';
  sortOrder: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface PlaylistEvent {
  id: string;
  playlistId: string;
  type: 'created' | 'updated' | 'deleted' | 'track_added' | 'track_removed' | 'track_moved' | 'shared' | 'played';
  userId: string;
  data: any;
  timestamp: Date;
}

export interface PlaylistQueueContext {
  playlistId: string;
  position: number;
  shuffled: boolean;
  repeatMode: 'none' | 'track' | 'playlist';
  smartQueueEnabled: boolean;
  crossfadeEnabled: boolean;
  history: string[]; // track IDs
  upcoming: string[]; // track IDs
}
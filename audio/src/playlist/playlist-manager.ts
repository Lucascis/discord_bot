/**
 * Advanced Playlist Manager
 * Professional playlist management with smart features
 */

import { EventEmitter } from 'events';
import { logger } from '@discord-bot/logger';
import {
  Playlist,
  Track,
  PlaylistCategory,
  PlaylistSettings,
  PlaylistAnalytics,
  SmartPlaylistCriteria,
  PlaylistRecommendation,
  PlaylistCollaboration,
  PlaylistImportRequest,
  PlaylistExportFormat,
  PlaylistSearchFilter,
  PlaylistEvent,
  PlaylistQueueContext
} from './types.js';

export class PlaylistManager extends EventEmitter {
  private playlists = new Map<string, Playlist>();
  private collaborations = new Map<string, PlaylistCollaboration[]>();
  private playlistEvents = new Map<string, PlaylistEvent[]>();
  private smartPlaylistCache = new Map<string, { criteria: SmartPlaylistCriteria; tracks: Track[]; cachedAt: Date }>();
  private recommendations = new Map<string, PlaylistRecommendation[]>();

  constructor() {
    super();
    this.setupCleanupInterval();
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(
    guildId: string,
    ownerId: string,
    name: string,
    options: {
      description?: string;
      isPublic?: boolean;
      isCollaborative?: boolean;
      category?: PlaylistCategory;
      tags?: string[];
      initialTracks?: Track[];
      settings?: Partial<PlaylistSettings>;
    } = {}
  ): Promise<Playlist> {
    const playlistId = this.generatePlaylistId();

    const playlist: Playlist = {
      id: playlistId,
      name: name.trim(),
      description: options.description?.trim(),
      guildId,
      ownerId,
      isPublic: options.isPublic ?? false,
      isCollaborative: options.isCollaborative ?? false,
      tracks: options.initialTracks ?? [],
      tags: options.tags ?? [],
      category: options.category ?? PlaylistCategory.PERSONAL,
      settings: {
        autoShuffle: false,
        crossfadeEnabled: false,
        smartQueue: false,
        repeatMode: 'none',
        allowDuplicates: true,
        moderationEnabled: false,
        bannedWords: [],
        ...options.settings
      },
      analytics: this.createInitialAnalytics(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.playlists.set(playlistId, playlist);

    if (options.isCollaborative) {
      this.collaborations.set(playlistId, [{
        userId: ownerId,
        role: 'admin',
        permissions: {
          canAddTracks: true,
          canRemoveTracks: true,
          canReorderTracks: true,
          canEditMetadata: true,
          canInviteOthers: true,
          canModerate: true
        },
        addedAt: new Date()
      }]);
    }

    this.logEvent(playlistId, 'created', ownerId, { name, category: playlist.category });
    this.emit('playlistCreated', playlist);

    logger.info({ playlistId, guildId, ownerId, name }, 'Playlist created');
    return playlist;
  }

  /**
   * Create smart playlist based on criteria
   */
  async createSmartPlaylist(
    guildId: string,
    ownerId: string,
    name: string,
    criteria: SmartPlaylistCriteria,
    options: {
      description?: string;
      isPublic?: boolean;
      autoUpdate?: boolean;
    } = {}
  ): Promise<Playlist> {
    const tracks = await this.generateSmartPlaylistTracks(guildId, criteria);

    const playlist = await this.createPlaylist(guildId, ownerId, name, {
      description: options.description ?? `Smart playlist: ${this.describeCriteria(criteria)}`,
      isPublic: options.isPublic,
      category: PlaylistCategory.MOOD_BASED,
      tags: ['smart', ...criteria.genres ?? [], ...criteria.moods ?? []],
      initialTracks: tracks,
      settings: {
        smartQueue: true,
        autoShuffle: criteria.genres?.includes('electronic') || criteria.moods?.includes('party')
      }
    });

    // Cache smart playlist for auto-updates
    if (options.autoUpdate) {
      this.smartPlaylistCache.set(playlist.id, {
        criteria,
        tracks,
        cachedAt: new Date()
      });
    }

    return playlist;
  }

  /**
   * Add track to playlist
   */
  async addTrack(
    playlistId: string,
    track: Track,
    userId: string,
    position?: number
  ): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return false;

    // Check permissions
    if (!await this.canUserModifyPlaylist(playlistId, userId, 'add')) {
      return false;
    }

    // Check for duplicates if not allowed
    if (!playlist.settings.allowDuplicates &&
        playlist.tracks.some(t => t.url === track.url)) {
      return false;
    }

    // Check max tracks limit
    if (playlist.settings.maxTracks &&
        playlist.tracks.length >= playlist.settings.maxTracks) {
      return false;
    }

    // Apply content moderation
    if (playlist.settings.moderationEnabled &&
        this.containsBannedWords(track, playlist.settings.bannedWords)) {
      return false;
    }

    const trackWithMetadata = {
      ...track,
      addedBy: userId,
      addedAt: new Date()
    };

    if (position !== undefined && position >= 0 && position <= playlist.tracks.length) {
      playlist.tracks.splice(position, 0, trackWithMetadata);
    } else {
      playlist.tracks.push(trackWithMetadata);
    }

    playlist.updatedAt = new Date();
    await this.updatePlaylistAnalytics(playlistId);

    this.logEvent(playlistId, 'track_added', userId, { track: track.id, position });
    this.emit('trackAdded', playlistId, trackWithMetadata, position);

    logger.info({ playlistId, trackId: track.id, userId }, 'Track added to playlist');
    return true;
  }

  /**
   * Remove track from playlist
   */
  async removeTrack(playlistId: string, trackIndex: number, userId: string): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist || trackIndex < 0 || trackIndex >= playlist.tracks.length) return false;

    if (!await this.canUserModifyPlaylist(playlistId, userId, 'remove')) {
      return false;
    }

    const removedTrack = playlist.tracks.splice(trackIndex, 1)[0];
    playlist.updatedAt = new Date();
    await this.updatePlaylistAnalytics(playlistId);

    this.logEvent(playlistId, 'track_removed', userId, { track: removedTrack.id, position: trackIndex });
    this.emit('trackRemoved', playlistId, removedTrack, trackIndex);

    logger.info({ playlistId, trackId: removedTrack.id, userId }, 'Track removed from playlist');
    return true;
  }

  /**
   * Reorder tracks in playlist
   */
  async reorderTracks(
    playlistId: string,
    fromIndex: number,
    toIndex: number,
    userId: string
  ): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return false;

    if (!await this.canUserModifyPlaylist(playlistId, userId, 'reorder')) {
      return false;
    }

    if (fromIndex < 0 || fromIndex >= playlist.tracks.length ||
        toIndex < 0 || toIndex >= playlist.tracks.length) {
      return false;
    }

    const track = playlist.tracks.splice(fromIndex, 1)[0];
    playlist.tracks.splice(toIndex, 0, track);
    playlist.updatedAt = new Date();

    this.logEvent(playlistId, 'track_moved', userId, { from: fromIndex, to: toIndex });
    this.emit('tracksReordered', playlistId, fromIndex, toIndex);

    return true;
  }

  /**
   * Shuffle playlist tracks
   */
  async shufflePlaylist(playlistId: string, userId: string): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return false;

    if (!await this.canUserModifyPlaylist(playlistId, userId, 'reorder')) {
      return false;
    }

    // Smart shuffle: avoid consecutive tracks from same artist
    const shuffled = this.smartShuffle(playlist.tracks);
    playlist.tracks = shuffled;
    playlist.updatedAt = new Date();

    this.emit('playlistShuffled', playlistId);
    return true;
  }

  /**
   * Get playlist recommendations
   */
  async getRecommendations(
    guildId: string,
    userId: string,
    basedOn?: 'listening_history' | 'liked_tracks' | 'similar_users',
    limit: number = 10
  ): Promise<PlaylistRecommendation[]> {
    const cacheKey = `${guildId}:${userId}:${basedOn}`;
    const cached = this.recommendations.get(cacheKey);

    if (cached && this.isCacheValid(cached[0]?.playlist?.updatedAt, 30 * 60 * 1000)) {
      return cached.slice(0, limit);
    }

    const recommendations = await this.generateRecommendations(guildId, userId, basedOn);
    this.recommendations.set(cacheKey, recommendations);

    return recommendations.slice(0, limit);
  }

  /**
   * Import playlist from external source
   */
  async importPlaylist(
    guildId: string,
    userId: string,
    request: PlaylistImportRequest
  ): Promise<Playlist | null> {
    try {
      const tracks = await this.extractTracksFromSource(request);
      if (!tracks.length) return null;

      const playlistName = await this.generateImportedPlaylistName(request);

      let playlist: Playlist;

      if (request.options.mergeWithExisting) {
        playlist = this.playlists.get(request.options.mergeWithExisting)!;
        if (!playlist) return null;

        for (const track of tracks) {
          await this.addTrack(playlist.id, track, userId);
        }
      } else {
        playlist = await this.createPlaylist(guildId, userId, playlistName, {
          isPublic: request.options.makePublic,
          initialTracks: tracks,
          tags: request.options.autoTag ? await this.generateTagsFromTracks(tracks) : []
        });
      }

      logger.info({
        playlistId: playlist.id,
        source: request.source,
        trackCount: tracks.length
      }, 'Playlist imported');

      return playlist;
    } catch (error) {
      logger.error({ error, request }, 'Failed to import playlist');
      return null;
    }
  }

  /**
   * Export playlist to various formats
   */
  async exportPlaylist(
    playlistId: string,
    format: PlaylistExportFormat
  ): Promise<string | null> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return null;

    try {
      switch (format.format) {
        case 'm3u8':
          return this.exportToM3U8(playlist, format);
        case 'json':
          return this.exportToJSON(playlist, format);
        case 'csv':
          return this.exportToCSV(playlist, format);
        case 'txt':
          return this.exportToTXT(playlist);
        case 'spotify_uri':
          return this.exportToSpotifyURI(playlist);
        default:
          return null;
      }
    } catch (error) {
      logger.error({ error, playlistId, format }, 'Failed to export playlist');
      return null;
    }
  }

  /**
   * Search playlists
   */
  async searchPlaylists(
    guildId: string,
    filter: PlaylistSearchFilter
  ): Promise<{ playlists: Playlist[]; total: number }> {
    let playlists = Array.from(this.playlists.values())
      .filter(p => p.guildId === guildId || p.isPublic);

    // Apply filters
    if (filter.query) {
      const query = filter.query.toLowerCase();
      playlists = playlists.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    if (filter.category) {
      playlists = playlists.filter(p => p.category === filter.category);
    }

    if (filter.tags?.length) {
      playlists = playlists.filter(p =>
        filter.tags!.some(tag => p.tags.includes(tag))
      );
    }

    if (filter.owner) {
      playlists = playlists.filter(p => p.ownerId === filter.owner);
    }

    if (filter.isPublic !== undefined) {
      playlists = playlists.filter(p => p.isPublic === filter.isPublic);
    }

    if (filter.isCollaborative !== undefined) {
      playlists = playlists.filter(p => p.isCollaborative === filter.isCollaborative);
    }

    if (filter.hasMinTracks) {
      playlists = playlists.filter(p => p.tracks.length >= filter.hasMinTracks!);
    }

    if (filter.createdAfter) {
      playlists = playlists.filter(p => p.createdAt >= filter.createdAfter!);
    }

    if (filter.minPopularity) {
      playlists = playlists.filter(p => p.analytics.popularityScore >= filter.minPopularity!);
    }

    // Sort results
    playlists.sort((a, b) => {
      const getValue = (playlist: Playlist) => {
        switch (filter.sortBy) {
          case 'name': return playlist.name;
          case 'created': return playlist.createdAt.getTime();
          case 'updated': return playlist.updatedAt.getTime();
          case 'popularity': return playlist.analytics.popularityScore;
          case 'duration': return playlist.analytics.totalDuration;
          case 'tracks': return playlist.tracks.length;
          default: return playlist.name;
        }
      };

      const aVal = getValue(a);
      const bVal = getValue(b);

      if (filter.sortOrder === 'desc') {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      } else {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
    });

    const total = playlists.length;
    const result = playlists.slice(filter.offset, filter.offset + filter.limit);

    return { playlists: result, total };
  }

  /**
   * Get playlist by ID
   */
  getPlaylist(playlistId: string): Playlist | undefined {
    return this.playlists.get(playlistId);
  }

  /**
   * Delete playlist
   */
  async deletePlaylist(playlistId: string, userId: string): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return false;

    if (playlist.ownerId !== userId) {
      const collaboration = this.collaborations.get(playlistId)
        ?.find(c => c.userId === userId && c.role === 'admin');
      if (!collaboration) return false;
    }

    this.playlists.delete(playlistId);
    this.collaborations.delete(playlistId);
    this.playlistEvents.delete(playlistId);
    this.smartPlaylistCache.delete(playlistId);

    this.logEvent(playlistId, 'deleted', userId, {});
    this.emit('playlistDeleted', playlistId);

    logger.info({ playlistId, userId }, 'Playlist deleted');
    return true;
  }

  /**
   * Private helper methods
   */
  private generatePlaylistId(): string {
    return `pl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private createInitialAnalytics(): PlaylistAnalytics {
    return {
      totalPlays: 0,
      totalDuration: 0,
      averageTrackRating: 0,
      skipRate: 0,
      completionRate: 0,
      popularityScore: 0,
      genreDistribution: {},
      moodProfile: {
        energy: 0.5,
        valence: 0.5,
        danceability: 0.5
      }
    };
  }

  private async canUserModifyPlaylist(
    playlistId: string,
    userId: string,
    action: 'add' | 'remove' | 'reorder'
  ): Promise<boolean> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return false;

    if (playlist.ownerId === userId) return true;

    if (playlist.isCollaborative) {
      const collaboration = this.collaborations.get(playlistId)
        ?.find(c => c.userId === userId);

      if (!collaboration) return false;

      switch (action) {
        case 'add': return collaboration.permissions.canAddTracks;
        case 'remove': return collaboration.permissions.canRemoveTracks;
        case 'reorder': return collaboration.permissions.canReorderTracks;
        default: return false;
      }
    }

    return false;
  }

  private containsBannedWords(track: Track, bannedWords: string[]): boolean {
    const content = `${track.title} ${track.artist}`.toLowerCase();
    return bannedWords.some(word => content.includes(word.toLowerCase()));
  }

  private smartShuffle(tracks: Track[]): Track[] {
    const shuffled = [...tracks];

    // Fisher-Yates shuffle with artist separation
    for (let i = shuffled.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));

      // Avoid consecutive tracks from same artist
      if (i > 1 && shuffled[j].artist === shuffled[i - 1].artist) {
        j = Math.floor(Math.random() * (i - 1));
      }

      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  private async updatePlaylistAnalytics(playlistId: string): Promise<void> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) return;

    playlist.analytics.totalDuration = playlist.tracks.reduce((sum, track) => sum + track.duration, 0);

    // Update genre distribution
    const genres: Record<string, number> = {};
    playlist.tracks.forEach(track => {
      if (track.metadata?.genre) {
        genres[track.metadata.genre] = (genres[track.metadata.genre] || 0) + 1;
      }
    });
    playlist.analytics.genreDistribution = genres;

    // Update mood profile
    const validTracks = playlist.tracks.filter(t => t.metadata?.energy !== undefined);
    if (validTracks.length > 0) {
      playlist.analytics.moodProfile = {
        energy: validTracks.reduce((sum, t) => sum + (t.metadata!.energy || 0), 0) / validTracks.length,
        valence: validTracks.reduce((sum, t) => sum + (t.metadata!.valence || 0), 0) / validTracks.length,
        danceability: validTracks.reduce((sum, t) => sum + (t.metadata!.danceability || 0), 0) / validTracks.length
      };
    }
  }

  private logEvent(playlistId: string, type: PlaylistEvent['type'], userId: string, data: any): void {
    const event: PlaylistEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      playlistId,
      type,
      userId,
      data,
      timestamp: new Date()
    };

    if (!this.playlistEvents.has(playlistId)) {
      this.playlistEvents.set(playlistId, []);
    }

    const events = this.playlistEvents.get(playlistId)!;
    events.push(event);

    // Keep only last 100 events per playlist
    if (events.length > 100) {
      events.splice(0, events.length - 100);
    }
  }

  private setupCleanupInterval(): void {
    // Clean up cache every hour
    setInterval(() => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      for (const [key, value] of this.smartPlaylistCache.entries()) {
        if (value.cachedAt.getTime() < oneHourAgo) {
          this.smartPlaylistCache.delete(key);
        }
      }

      for (const [key, value] of this.recommendations.entries()) {
        if (value[0]?.playlist?.updatedAt.getTime() < oneHourAgo) {
          this.recommendations.delete(key);
        }
      }
    }, 60 * 60 * 1000);
  }

  private isCacheValid(lastUpdate: Date | undefined, maxAge: number): boolean {
    if (!lastUpdate) return false;
    return Date.now() - lastUpdate.getTime() < maxAge;
  }

  // Placeholder methods for external integrations
  private async generateSmartPlaylistTracks(guildId: string, criteria: SmartPlaylistCriteria): Promise<Track[]> {
    // Implementation would integrate with music database and AI recommendations
    return [];
  }

  private describeCriteria(criteria: SmartPlaylistCriteria): string {
    const parts = [];
    if (criteria.genres?.length) parts.push(`${criteria.genres.join(', ')} music`);
    if (criteria.moods?.length) parts.push(`${criteria.moods.join(', ')} mood`);
    if (criteria.bpmRange) parts.push(`${criteria.bpmRange.min}-${criteria.bpmRange.max} BPM`);
    return parts.join(', ') || 'Various criteria';
  }

  private async generateRecommendations(guildId: string, userId: string, basedOn?: string): Promise<PlaylistRecommendation[]> {
    // Implementation would use ML recommendations
    return [];
  }

  private async extractTracksFromSource(request: PlaylistImportRequest): Promise<Track[]> {
    // Implementation would handle various import sources
    return [];
  }

  private async generateImportedPlaylistName(request: PlaylistImportRequest): Promise<string> {
    return `Imported from ${request.source} - ${new Date().toLocaleDateString()}`;
  }

  private async generateTagsFromTracks(tracks: Track[]): Promise<string[]> {
    const genres = new Set<string>();
    tracks.forEach(track => {
      if (track.metadata?.genre) genres.add(track.metadata.genre);
    });
    return Array.from(genres);
  }

  private exportToM3U8(playlist: Playlist, format: PlaylistExportFormat): string {
    let m3u8 = '#EXTM3U\n';
    playlist.tracks.forEach(track => {
      m3u8 += `#EXTINF:${Math.floor(track.duration / 1000)},${track.artist} - ${track.title}\n`;
      m3u8 += `${track.url}\n`;
    });
    return m3u8;
  }

  private exportToJSON(playlist: Playlist, format: PlaylistExportFormat): string {
    const data = {
      playlist: {
        name: playlist.name,
        description: playlist.description,
        tracks: playlist.tracks
      }
    };

    if (format.includeMetadata) {
      Object.assign(data.playlist, {
        category: playlist.category,
        tags: playlist.tags,
        settings: playlist.settings
      });
    }

    if (format.includeAnalytics) {
      Object.assign(data.playlist, { analytics: playlist.analytics });
    }

    return JSON.stringify(data, null, 2);
  }

  private exportToCSV(playlist: Playlist, format: PlaylistExportFormat): string {
    const headers = ['Title', 'Artist', 'Duration', 'URL'];
    if (format.includeMetadata) {
      headers.push('Album', 'Genre', 'Year');
    }

    let csv = headers.join(',') + '\n';

    playlist.tracks.forEach(track => {
      const row = [
        this.escapeCsvField(track.title),
        this.escapeCsvField(track.artist),
        Math.floor(track.duration / 1000),
        track.url
      ];

      if (format.includeMetadata) {
        row.push(
          this.escapeCsvField(track.metadata?.album || ''),
          this.escapeCsvField(track.metadata?.genre || ''),
          track.metadata?.year?.toString() || ''
        );
      }

      csv += row.join(',') + '\n';
    });

    return csv;
  }

  private exportToTXT(playlist: Playlist): string {
    return playlist.tracks
      .map(track => `${track.artist} - ${track.title}`)
      .join('\n');
  }

  private exportToSpotifyURI(playlist: Playlist): string {
    return playlist.tracks
      .filter(track => track.source === 'spotify')
      .map(track => track.url)
      .join('\n');
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
}
/**
 * Intelligent Queue Management System
 * Advanced queue logic for premium Discord Music Bot
 */

import { EventEmitter } from 'events';
import { logger } from '@discord-bot/logger';

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  source: 'youtube' | 'spotify' | 'soundcloud' | 'deezer' | 'applemusic';
  requestedBy: string;
  addedAt: Date;

  // Audio analysis data
  analysis?: {
    bpm: number;
    key: string;
    energy: number;      // 0-1
    danceability: number; // 0-1
    valence: number;     // 0-1 (happiness)
    acousticness: number; // 0-1
    instrumentalness: number; // 0-1
    genre?: string[];
  };

  // Metadata
  thumbnail?: string;
  lyrics?: string;
  explicit: boolean;
  popularity?: number; // 0-100
}

export interface QueueState {
  guildId: string;
  tracks: Track[];
  currentIndex: number;
  history: Track[];
  shuffle: {
    enabled: boolean;
    originalOrder: number[];
    playedIndices: Set<number>;
  };
  repeat: {
    mode: 'off' | 'track' | 'queue';
    trackRepeats: number;
  };
  autoplay: {
    enabled: boolean;
    mode: 'similar' | 'artist' | 'genre' | 'mood' | 'mixed';
    seedTracks: Track[];
  };
  filters: {
    duplicateProtection: boolean;
    explicitFilter: boolean;
    maxDuration?: number;
    genreFilter?: string[];
  };
}

export interface QueueTemplate {
  name: string;
  description: string;
  tracks: Track[];
  settings: {
    shuffle: boolean;
    repeat: 'off' | 'queue';
    autoplay: boolean;
  };
}

interface QueueAnalytics {
  totalTracks: number;
  totalDuration: number;
  averageEnergy: number;
  genreDistribution: Record<string, number>;
  repeatMode: QueueState['repeat']['mode'];
  shuffleEnabled: boolean;
  autoplayEnabled: boolean;
  historySize: number;
}

export class IntelligentQueue extends EventEmitter {
  private guildQueues = new Map<string, QueueState>();
  private queueTemplates = new Map<string, QueueTemplate[]>();
  private antiRepeatHistory = new Map<string, Set<string>>();

  constructor() {
    super();
    this.setupQueueTemplates();
    this.setupAntiRepeatSystem();
  }

  /**
   * Initialize queue for guild
   */
  async initializeQueue(guildId: string): Promise<QueueState> {
    const defaultQueue: QueueState = {
      guildId,
      tracks: [],
      currentIndex: -1,
      history: [],
      shuffle: {
        enabled: false,
        originalOrder: [],
        playedIndices: new Set()
      },
      repeat: {
        mode: 'off',
        trackRepeats: 0
      },
      autoplay: {
        enabled: false,
        mode: 'similar',
        seedTracks: []
      },
      filters: {
        duplicateProtection: true,
        explicitFilter: false
      }
    };

    this.guildQueues.set(guildId, defaultQueue);
    this.antiRepeatHistory.set(guildId, new Set());

    logger.info({ guildId }, 'Intelligent queue initialized');
    return defaultQueue;
  }

  /**
   * Smart track addition with duplicate detection and quality filtering
   */
  async addTrack(guildId: string, track: Track, position?: number): Promise<boolean> {
    const queue = await this.getOrCreateQueue(guildId);

    // Apply filters
    if (!this.passesFilters(track, queue)) {
      logger.info({ guildId, trackId: track.id }, 'Track rejected by filters');
      return false;
    }

    // Duplicate protection
    if (queue.filters.duplicateProtection && this.isDuplicate(track, queue)) {
      logger.info({ guildId, trackId: track.id }, 'Duplicate track rejected');
      return false;
    }

    // Add track at specified position or end
    if (position !== undefined && position >= 0 && position < queue.tracks.length) {
      queue.tracks.splice(position, 0, track);
    } else {
      queue.tracks.push(track);
    }

    // Update shuffle order if enabled
    if (queue.shuffle.enabled) {
      this.updateShuffleOrder(queue);
    }

    this.emit('trackAdded', guildId, track, queue.tracks.length);
    logger.info({ guildId, trackId: track.id, position: queue.tracks.length }, 'Track added to queue');

    return true;
  }

  /**
   * Intelligent batch add with smart ordering
   */
  async addTracks(guildId: string, tracks: Track[]): Promise<number> {
    await this.getOrCreateQueue(guildId);
    let addedCount = 0;

    // Smart ordering: group by artist, then by energy level
    const sortedTracks = this.smartSortTracks(tracks);

    for (const track of sortedTracks) {
      if (await this.addTrack(guildId, track)) {
        addedCount++;
      }
    }

    this.emit('tracksAdded', guildId, addedCount, tracks.length);
    return addedCount;
  }

  /**
   * Smart next track selection
   */
  async getNextTrack(guildId: string): Promise<Track | null> {
    const queue = await this.getOrCreateQueue(guildId);

    // Handle repeat track
    if (queue.repeat.mode === 'track' && queue.currentIndex >= 0) {
      const currentTrack = queue.tracks[queue.currentIndex];
      if (currentTrack) {
        queue.repeat.trackRepeats++;
        logger.info({ guildId, repeats: queue.repeat.trackRepeats }, 'Repeating current track');
        return currentTrack;
      }
    }

    // Get next track in queue
    let nextIndex = queue.currentIndex + 1;

    // Handle shuffle
    if (queue.shuffle.enabled) {
      nextIndex = this.getNextShuffleIndex(queue);
    }

    // Check if we have a next track
    if (nextIndex < queue.tracks.length) {
      queue.currentIndex = nextIndex;
      const nextTrack = queue.tracks[nextIndex];

      // Add to history
      if (queue.history.length > 50) {
        queue.history.shift(); // Keep history manageable
      }
      queue.history.push(nextTrack);

      // Update anti-repeat history
      this.updateAntiRepeatHistory(guildId, nextTrack);

      this.emit('trackChanged', guildId, nextTrack, nextIndex);
      return nextTrack;
    }

    // Handle queue repeat
    if (queue.repeat.mode === 'queue' && queue.tracks.length > 0) {
      queue.currentIndex = 0;
      if (queue.shuffle.enabled) {
        this.resetShuffle(queue);
      }
      return this.getNextTrack(guildId); // Recursively get first track
    }

    // Try autoplay if enabled
    if (queue.autoplay.enabled && queue.tracks.length > 0) {
      const autoplayTrack = await this.generateAutoplayTrack(guildId);
      if (autoplayTrack) {
        await this.addTrack(guildId, autoplayTrack);
        return this.getNextTrack(guildId);
      }
    }

    logger.info({ guildId }, 'No next track available');
    return null;
  }

  /**
   * Smart shuffle implementation
   */
  async enableShuffle(guildId: string): Promise<void> {
    const queue = await this.getOrCreateQueue(guildId);

    if (!queue.shuffle.enabled) {
      queue.shuffle.enabled = true;
      queue.shuffle.originalOrder = queue.tracks.map((_, index) => index);
      queue.shuffle.playedIndices = new Set([queue.currentIndex]);

      this.generateSmartShuffleOrder(queue);

      this.emit('shuffleEnabled', guildId);
      logger.info({ guildId }, 'Smart shuffle enabled');
    }
  }

  /**
   * Smart autoplay based on listening patterns
   */
  async generateAutoplayTrack(guildId: string): Promise<Track | null> {
    const queue = await this.getOrCreateQueue(guildId);
    const antiRepeat = this.antiRepeatHistory.get(guildId) || new Set();

    try {
      // Analyze recent tracks for patterns
      const recentTracks = queue.history.slice(-5);
      const seedTrack = this.selectBestSeedTrack(recentTracks, queue.autoplay.mode);

      if (!seedTrack?.analysis) {
        return null;
      }

      // Generate recommendation based on mode
      const recommendation = await this.generateRecommendation(
        seedTrack,
        queue.autoplay.mode,
        antiRepeat
      );

      if (recommendation) {
        logger.info({
          guildId,
          mode: queue.autoplay.mode,
          seedTrack: seedTrack.title
        }, 'Generated autoplay recommendation');
      }

      return recommendation;

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to generate autoplay track');
      return null;
    }
  }

  /**
   * Queue templates for quick setup
   */
  async applyTemplate(guildId: string, templateName: string): Promise<boolean> {
    const templates = this.queueTemplates.get(templateName);
    if (!templates || templates.length === 0) {
      return false;
    }

    const template = templates[0]; // Use first template for now
    const queue = await this.getOrCreateQueue(guildId);

    // Clear current queue
    queue.tracks = [...template.tracks];
    queue.currentIndex = -1;
    queue.history = [];

    // Apply template settings
    if (template.settings.shuffle) {
      await this.enableShuffle(guildId);
    }

    queue.repeat.mode = template.settings.repeat;
    queue.autoplay.enabled = template.settings.autoplay;

    this.emit('templateApplied', guildId, templateName, template.tracks.length);
    logger.info({ guildId, template: templateName }, 'Queue template applied');

    return true;
  }

  /**
   * Queue analytics and insights
   */
  getQueueAnalytics(guildId: string): QueueAnalytics | null {
    const queue = this.guildQueues.get(guildId);
    if (!queue) return null;

    const totalDuration = queue.tracks.reduce((sum, track) => sum + track.duration, 0);
    const averageEnergy = queue.tracks
      .filter(t => t.analysis?.energy)
      .reduce((sum, t, _, arr) => sum + (t.analysis!.energy / arr.length), 0);

    const genreDistribution = queue.tracks
      .flatMap(t => t.analysis?.genre || [])
      .reduce((acc, genre) => {
        acc[genre] = (acc[genre] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      totalTracks: queue.tracks.length,
      totalDuration,
      averageEnergy,
      genreDistribution,
      repeatMode: queue.repeat.mode,
      shuffleEnabled: queue.shuffle.enabled,
      autoplayEnabled: queue.autoplay.enabled,
      historySize: queue.history.length
    };
  }

  /**
   * Private helper methods
   */
  private async getOrCreateQueue(guildId: string): Promise<QueueState> {
    let queue = this.guildQueues.get(guildId);
    if (!queue) {
      queue = await this.initializeQueue(guildId);
    }
    return queue;
  }

  private passesFilters(track: Track, queue: QueueState): boolean {
    // Explicit content filter
    if (queue.filters.explicitFilter && track.explicit) {
      return false;
    }

    // Duration filter
    if (queue.filters.maxDuration && track.duration > queue.filters.maxDuration) {
      return false;
    }

    // Genre filter
    if (queue.filters.genreFilter && track.analysis?.genre) {
      const hasAllowedGenre = track.analysis.genre.some(
        genre => queue.filters.genreFilter!.includes(genre)
      );
      if (!hasAllowedGenre) {
        return false;
      }
    }

    return true;
  }

  private isDuplicate(track: Track, queue: QueueState): boolean {
    return queue.tracks.some(existing =>
      existing.url === track.url ||
      (existing.title === track.title && existing.artist === track.artist)
    );
  }

  private smartSortTracks(tracks: Track[]): Track[] {
    // Group by artist first, then sort by energy for flow
    return tracks.sort((a, b) => {
      // Same artist should be grouped
      if (a.artist === b.artist) {
        const energyA = a.analysis?.energy || 0.5;
        const energyB = b.analysis?.energy || 0.5;
        return energyA - energyB; // Ascending energy
      }
      return a.artist.localeCompare(b.artist);
    });
  }

  private generateSmartShuffleOrder(queue: QueueState): void {
    // Generate shuffle order that avoids playing similar tracks consecutively
    const tracks = queue.tracks;
    const shuffleOrder: number[] = [];
    const available = new Set(tracks.map((_, i) => i));

    // Remove current track from available
    if (queue.currentIndex >= 0) {
      available.delete(queue.currentIndex);
    }

    let lastTrack: Track | null = queue.currentIndex >= 0 ? tracks[queue.currentIndex] : null;

    while (available.size > 0) {
      const candidates = Array.from(available);

      if (lastTrack?.analysis) {
        // Sort candidates by difference from last track
        candidates.sort((a, b) => {
          const trackA = tracks[a];
          const trackB = tracks[b];

          const diffA = this.calculateTrackDifference(lastTrack!, trackA);
          const diffB = this.calculateTrackDifference(lastTrack!, trackB);

          return diffB - diffA; // Prefer more different tracks
        });
      }

      // Pick from top 3 most different (add some randomness)
      const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
      const nextIndex = topCandidates[Math.floor(Math.random() * topCandidates.length)];

      shuffleOrder.push(nextIndex);
      available.delete(nextIndex);
      lastTrack = tracks[nextIndex];
    }

    // Store shuffle order (this would be used by getNextShuffleIndex)
    queue.shuffle.originalOrder = shuffleOrder;
  }

  private calculateTrackDifference(track1: Track, track2: Track): number {
    if (!track1.analysis || !track2.analysis) return Math.random();

    const bpmDiff = Math.abs(track1.analysis.bpm - track2.analysis.bpm) / 200; // Normalize
    const energyDiff = Math.abs(track1.analysis.energy - track2.analysis.energy);
    const valenceDiff = Math.abs(track1.analysis.valence - track2.analysis.valence);

    return (bpmDiff + energyDiff + valenceDiff) / 3;
  }

  private getNextShuffleIndex(queue: QueueState): number {
    // Simple implementation - would use the smart shuffle order
    const remaining = queue.tracks.length - queue.shuffle.playedIndices.size;
    if (remaining <= 0) {
      this.resetShuffle(queue);
    }

    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * queue.tracks.length);
    } while (queue.shuffle.playedIndices.has(nextIndex));

    queue.shuffle.playedIndices.add(nextIndex);
    return nextIndex;
  }

  private resetShuffle(queue: QueueState): void {
    queue.shuffle.playedIndices.clear();
    this.generateSmartShuffleOrder(queue);
  }

  private updateShuffleOrder(queue: QueueState): void {
    if (queue.shuffle.enabled) {
      // Regenerate shuffle order when tracks are added
      this.generateSmartShuffleOrder(queue);
    }
  }

  private selectBestSeedTrack(tracks: Track[], mode: string): Track | null {
    if (tracks.length === 0) return null;

    switch (mode) {
      case 'similar':
        return tracks[tracks.length - 1]; // Most recent
      case 'artist':
        return tracks.find(t => t.analysis) || tracks[0];
      case 'genre':
        return tracks.find(t => t.analysis?.genre?.length) || tracks[0];
      case 'mood':
        return tracks.find(t => t.analysis?.valence !== undefined) || tracks[0];
      default:
        return tracks[Math.floor(Math.random() * tracks.length)];
    }
  }

  private async generateRecommendation(
    seedTrack: Track,
    mode: string,
    antiRepeat: Set<string>
  ): Promise<Track | null> {
    // This would integrate with actual recommendation services
    // For now, return a mock recommendation

    logger.info({
      seedTrack: seedTrack.title,
      mode,
      antiRepeatSize: antiRepeat.size
    }, 'Generating recommendation (mock)');

    // Mock implementation
    return null;
  }

  private updateAntiRepeatHistory(guildId: string, track: Track): void {
    const history = this.antiRepeatHistory.get(guildId) || new Set();
    history.add(track.id);

    // Keep last 100 tracks in anti-repeat history
    if (history.size > 100) {
      const oldest = Array.from(history)[0];
      history.delete(oldest);
    }

    this.antiRepeatHistory.set(guildId, history);
  }

  private setupQueueTemplates(): void {
    // Initialize default queue templates
    const defaultTemplates: Record<string, QueueTemplate[]> = {
      'party': [{
        name: 'Party Mix',
        description: 'High energy tracks for parties',
        tracks: [], // Would be populated with actual tracks
        settings: {
          shuffle: true,
          repeat: 'queue',
          autoplay: true
        }
      }],
      'chill': [{
        name: 'Chill Vibes',
        description: 'Relaxed tracks for chilling',
        tracks: [],
        settings: {
          shuffle: false,
          repeat: 'off',
          autoplay: true
        }
      }],
      'gaming': [{
        name: 'Gaming Focus',
        description: 'Perfect for gaming sessions',
        tracks: [],
        settings: {
          shuffle: true,
          repeat: 'queue',
          autoplay: true
        }
      }]
    };

    Object.entries(defaultTemplates).forEach(([name, templates]) => {
      this.queueTemplates.set(name, templates);
    });

    logger.info('Queue templates initialized');
  }

  private setupAntiRepeatSystem(): void {
    // Clean up anti-repeat history periodically
    setInterval(() => {
      for (const [, history] of this.antiRepeatHistory.entries()) {
        if (history.size > 200) {
          const toDelete = Array.from(history).slice(0, 100);
          toDelete.forEach(id => history.delete(id));
        }
      }
    }, 300000); // Every 5 minutes

    logger.info('Anti-repeat system initialized');
  }
}

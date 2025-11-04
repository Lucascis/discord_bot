/**
 * AI Music Intelligence Engine
 * Advanced music analysis and recommendation system
 */

import { EventEmitter } from 'events';
import { logger } from '@discord-bot/logger';
import { Track } from '../queue/intelligent-queue.js';

export interface AudioAnalysis {
  // Spotify-style audio features
  acousticness: number;     // 0.0 to 1.0
  danceability: number;     // 0.0 to 1.0
  energy: number;          // 0.0 to 1.0
  instrumentalness: number; // 0.0 to 1.0
  liveness: number;        // 0.0 to 1.0
  loudness: number;        // -60 to 0 dB
  speechiness: number;     // 0.0 to 1.0
  valence: number;         // 0.0 to 1.0 (musical positivity)
  tempo: number;           // BPM
  key: number;             // 0-11 (C, C#, D, etc.)
  mode: number;            // 0 = minor, 1 = major
  timeSignature: number;   // beats per bar
  duration: number;        // milliseconds
}

export interface MoodProfile {
  energy: number;          // High energy vs chill
  valence: number;         // Happy vs sad
  danceability: number;    // Danceable vs ambient
  acousticness: number;    // Acoustic vs electronic
  intensity: number;       // Intense vs gentle
}

export interface ListeningContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: 'weekday' | 'weekend';
  activity: 'gaming' | 'working' | 'party' | 'chill' | 'exercise' | 'study';
  serverSize: 'small' | 'medium' | 'large';
  previousTracks: Track[];
}

export interface RecommendationSeed {
  tracks?: Track[];
  artists?: string[];
  genres?: string[];
  features?: Partial<AudioAnalysis>;
  mood?: MoodProfile;
}

type ListeningPattern = ListeningContext & { timestamp: Date };

export class MusicIntelligenceEngine extends EventEmitter {
  private trackAnalysiCache = new Map<string, AudioAnalysis>();
  private userPreferences = new Map<string, MoodProfile>();
  private guildListeningPatterns = new Map<string, ListeningPattern[]>();
  private genreClassifier = new Map<string, string[]>();

  constructor() {
    super();
    this.initializeGenreClassifier();
    this.startPatternAnalysis();
  }

  /**
   * Analyze track audio features (would integrate with Spotify API or audio analysis service)
   */
  async analyzeTrack(track: Track): Promise<AudioAnalysis | null> {
    try {
      // Check cache first
      const cached = this.trackAnalysiCache.get(track.url);
      if (cached) return cached;

      // For now, generate mock analysis based on track data
      const analysis = await this.generateMockAnalysis(track);

      if (analysis) {
        this.trackAnalysiCache.set(track.url, analysis);
        logger.info({ trackId: track.id, title: track.title }, 'Track analysis completed');
      }

      return analysis;

    } catch (error) {
      logger.error({ error, trackId: track.id }, 'Failed to analyze track');
      return null;
    }
  }

  /**
   * Generate intelligent recommendations based on context and preferences
   */
  async generateRecommendations(
    guildId: string,
    seed: RecommendationSeed,
    context: ListeningContext,
    count: number = 5
  ): Promise<Track[]> {
    try {
      logger.info({
        guildId,
        seedType: this.getSeedType(seed),
        context: context.activity,
        count
      }, 'Generating AI recommendations');

      // Analyze listening patterns for this guild
      const patterns = this.guildListeningPatterns.get(guildId) || [];
      const recentPatterns = patterns.slice(-20); // Last 20 sessions

      // Build target profile from seed and context
      const targetProfile = await this.buildTargetProfile(seed, context, recentPatterns);

      // Generate recommendations based on profile
      const recommendations = await this.findSimilarTracks(targetProfile, count);

      this.emit('recommendationsGenerated', {
        guildId,
        count: recommendations.length,
        targetProfile,
        context
      });

      return recommendations;

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to generate recommendations');
      return [];
    }
  }

  /**
   * Detect mood from track or listening session
   */
  async detectMood(tracks: Track[]): Promise<MoodProfile> {
    if (tracks.length === 0) {
      return this.getDefaultMood();
    }

    try {
      const analyses = await Promise.all(
        tracks.map(track => this.analyzeTrack(track))
      );

      const validAnalyses = analyses.filter(Boolean) as AudioAnalysis[];
      if (validAnalyses.length === 0) {
        return this.getDefaultMood();
      }

      // Calculate average mood characteristics
      const mood: MoodProfile = {
        energy: this.averageFeature(validAnalyses, 'energy'),
        valence: this.averageFeature(validAnalyses, 'valence'),
        danceability: this.averageFeature(validAnalyses, 'danceability'),
        acousticness: this.averageFeature(validAnalyses, 'acousticness'),
        intensity: this.calculateIntensity(validAnalyses)
      };

      logger.info({
        trackCount: tracks.length,
        mood: this.describeMood(mood)
      }, 'Mood detected from tracks');

      return mood;

    } catch (error) {
      logger.error({ error }, 'Failed to detect mood');
      return this.getDefaultMood();
    }
  }

  /**
   * Smart genre detection and classification
   */
  async detectGenres(track: Track): Promise<string[]> {
    try {
      const analysis = await this.analyzeTrack(track);
      if (!analysis) return [];

      const genres: string[] = [];

      // Electronic music detection
      if (analysis.acousticness < 0.3 && analysis.energy > 0.6) {
        if (analysis.danceability > 0.7) {
          if (analysis.tempo > 125) {
            genres.push('house', 'techno', 'dance');
          } else {
            genres.push('downtempo', 'chillout');
          }
        } else {
          genres.push('electronic', 'ambient');
        }
      }

      // Rock/Metal detection
      if (analysis.energy > 0.7 && analysis.loudness > -8) {
        if (analysis.valence < 0.4) {
          genres.push('metal', 'hard rock');
        } else {
          genres.push('rock', 'alternative');
        }
      }

      // Hip-hop detection
      if (analysis.speechiness > 0.33 && analysis.danceability > 0.6) {
        genres.push('hip-hop', 'rap');
      }

      // Classical detection
      if (analysis.acousticness > 0.8 && analysis.instrumentalness > 0.8) {
        genres.push('classical', 'instrumental');
      }

      // Jazz detection
      if (analysis.acousticness > 0.5 && analysis.instrumentalness > 0.3 && analysis.tempo < 140) {
        genres.push('jazz', 'blues');
      }

      // Pop detection
      if (analysis.danceability > 0.5 && analysis.valence > 0.5 && analysis.energy > 0.4) {
        genres.push('pop');
      }

      // Use title/artist analysis as fallback
      const titleGenres = this.detectGenresFromText(track.title, track.artist);
      genres.push(...titleGenres);

      const uniqueGenres = [...new Set(genres)].slice(0, 3); // Max 3 genres

      logger.info({
        trackId: track.id,
        genres: uniqueGenres
      }, 'Genres detected for track');

      return uniqueGenres;

    } catch (error) {
      logger.error({ error, trackId: track.id }, 'Failed to detect genres');
      return [];
    }
  }

  /**
   * Learn from user interactions and preferences
   */
  async learnFromInteraction(
    guildId: string,
    userId: string,
    track: Track,
    interaction: 'skip' | 'replay' | 'add_to_queue' | 'like' | 'dislike'
  ): Promise<void> {
    try {
      const analysis = await this.analyzeTrack(track);
      if (!analysis) return;

      const userKey = `${guildId}:${userId}`;
      let preferences = this.userPreferences.get(userKey) || this.getDefaultMood();

      // Adjust preferences based on interaction
      const weight = this.getInteractionWeight(interaction);
      const adjustedFeatures = this.extractMoodFromAnalysis(analysis);

      preferences = this.blendMoods(preferences, adjustedFeatures, weight);
      this.userPreferences.set(userKey, preferences);

      logger.info({
        guildId,
        userId,
        interaction,
        track: track.title
      }, 'Learning from user interaction');

    } catch (error) {
      logger.error({ error, guildId, userId }, 'Failed to learn from interaction');
    }
  }

  /**
   * Update listening context for pattern analysis
   */
  updateListeningContext(guildId: string, context: ListeningContext): void {
    const patterns = this.guildListeningPatterns.get(guildId) || [];
    patterns.push({
      ...context,
      // Add timestamp for pattern analysis
      timestamp: new Date()
    });

    // Keep last 100 contexts
    if (patterns.length > 100) {
      patterns.shift();
    }

    this.guildListeningPatterns.set(guildId, patterns);

    logger.debug({ guildId, activity: context.activity }, 'Listening context updated');
  }

  /**
   * Get personalized recommendations for user
   */
  async getPersonalizedRecommendations(
    guildId: string,
    userId: string,
    context: ListeningContext,
    count: number = 5
  ): Promise<Track[]> {
    const userKey = `${guildId}:${userId}`;
    const preferences = this.userPreferences.get(userKey);

    if (!preferences) {
      // Use general recommendations if no user preferences
      return this.generateRecommendations(guildId, {}, context, count);
    }

    // Use user preferences as seed
    const seed: RecommendationSeed = {
      mood: preferences,
      features: this.moodToFeatures(preferences)
    };

    return this.generateRecommendations(guildId, seed, context, count);
  }

  /**
   * Private helper methods
   */
  private async generateMockAnalysis(track: Track): Promise<AudioAnalysis> {
    // Generate realistic mock analysis based on track metadata
    // In production, this would call Spotify API or audio analysis service

    const baseAnalysis: AudioAnalysis = {
      acousticness: Math.random(),
      danceability: Math.random(),
      energy: Math.random(),
      instrumentalness: Math.random() * 0.7, // Most tracks have some vocals
      liveness: Math.random() * 0.3, // Most tracks are studio recordings
      loudness: -15 + Math.random() * 10, // -15 to -5 dB typical range
      speechiness: Math.random() * 0.4, // Most music < 0.4
      valence: Math.random(),
      tempo: 60 + Math.random() * 140, // 60-200 BPM
      key: Math.floor(Math.random() * 12),
      mode: Math.random() > 0.5 ? 1 : 0,
      timeSignature: Math.random() > 0.8 ? 3 : 4, // Mostly 4/4 time
      duration: track.duration
    };

    // Adjust based on genre clues in title/artist
    this.adjustAnalysisForGenre(baseAnalysis, track);

    return baseAnalysis;
  }

  private adjustAnalysisForGenre(analysis: AudioAnalysis, track: Track): void {
    const text = `${track.title} ${track.artist}`.toLowerCase();

    // Electronic music adjustments
    if (text.includes('electronic') || text.includes('edm') || text.includes('house')) {
      analysis.acousticness *= 0.3;
      analysis.danceability = Math.max(0.6, analysis.danceability);
      analysis.energy = Math.max(0.6, analysis.energy);
      analysis.tempo = Math.max(120, analysis.tempo);
    }

    // Rock adjustments
    if (text.includes('rock') || text.includes('metal')) {
      analysis.energy = Math.max(0.7, analysis.energy);
      analysis.loudness = Math.max(-10, analysis.loudness);
      analysis.acousticness *= 0.4;
    }

    // Classical adjustments
    if (text.includes('classical') || text.includes('symphony')) {
      analysis.acousticness = Math.max(0.8, analysis.acousticness);
      analysis.instrumentalness = Math.max(0.8, analysis.instrumentalness);
      analysis.speechiness *= 0.1;
    }

    // Jazz adjustments
    if (text.includes('jazz') || text.includes('blues')) {
      analysis.acousticness = Math.max(0.5, analysis.acousticness);
      analysis.instrumentalness = Math.max(0.4, analysis.instrumentalness);
    }

    // Pop adjustments
    if (text.includes('pop')) {
      analysis.danceability = Math.max(0.5, analysis.danceability);
      analysis.valence = Math.max(0.5, analysis.valence);
      analysis.speechiness = Math.min(0.2, analysis.speechiness);
    }
  }

  private async buildTargetProfile(
    seed: RecommendationSeed,
    context: ListeningContext,
    patterns: ListeningPattern[]
  ): Promise<Partial<AudioAnalysis>> {
    let profile: Partial<AudioAnalysis> = {};

    // Start with seed features
    if (seed.features) {
      profile = { ...seed.features };
    }

    // Adjust for mood
    if (seed.mood) {
      profile.energy = seed.mood.energy;
      profile.valence = seed.mood.valence;
      profile.danceability = seed.mood.danceability;
      profile.acousticness = seed.mood.acousticness;
    }

    // Adjust for context
    profile = this.adjustProfileForContext(profile, context);

    // Consider patterns
    profile = this.adjustProfileForPatterns(profile, patterns);

    return profile;
  }

  private adjustProfileForContext(
    profile: Partial<AudioAnalysis>,
    context: ListeningContext
  ): Partial<AudioAnalysis> {
    const adjusted = { ...profile };

    switch (context.activity) {
      case 'gaming':
        adjusted.energy = Math.max(0.6, adjusted.energy || 0.6);
        adjusted.danceability = Math.max(0.5, adjusted.danceability || 0.5);
        adjusted.valence = Math.max(0.4, adjusted.valence || 0.4);
        break;

      case 'study':
        adjusted.energy = Math.min(0.4, adjusted.energy || 0.3);
        adjusted.acousticness = Math.max(0.5, adjusted.acousticness || 0.5);
        adjusted.speechiness = Math.min(0.2, adjusted.speechiness || 0.1);
        break;

      case 'party':
        adjusted.energy = Math.max(0.7, adjusted.energy || 0.7);
        adjusted.danceability = Math.max(0.8, adjusted.danceability || 0.8);
        adjusted.valence = Math.max(0.6, adjusted.valence || 0.6);
        break;

      case 'chill':
        adjusted.energy = Math.min(0.5, adjusted.energy || 0.3);
        adjusted.valence = Math.min(0.7, adjusted.valence || 0.5);
        break;

      case 'exercise':
        adjusted.energy = Math.max(0.8, adjusted.energy || 0.8);
        adjusted.tempo = Math.max(120, adjusted.tempo || 130);
        adjusted.danceability = Math.max(0.6, adjusted.danceability || 0.6);
        break;
    }

    // Time of day adjustments
    switch (context.timeOfDay) {
      case 'morning':
        adjusted.energy = Math.max(0.5, adjusted.energy || 0.5);
        adjusted.valence = Math.max(0.5, adjusted.valence || 0.5);
        break;

      case 'night':
        adjusted.energy = Math.min(0.6, adjusted.energy || 0.4);
        adjusted.acousticness = Math.max(0.3, adjusted.acousticness || 0.3);
        break;
    }

    return adjusted;
  }

  private adjustProfileForPatterns(
    profile: Partial<AudioAnalysis>,
    patterns: ListeningPattern[]
  ): Partial<AudioAnalysis> {
    if (patterns.length === 0) return profile;

    // Analyze common activities and preferences
    const activityCounts = patterns.reduce((acc, pattern) => {
      acc[pattern.activity] = (acc[pattern.activity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostCommonActivity = Object.entries(activityCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0];

    if (mostCommonActivity) {
      // Slightly bias towards historically preferred activity
      const contextualProfile = this.adjustProfileForContext(profile, {
        ...patterns[0],
        activity: mostCommonActivity as ListeningContext['activity']
      });

      // Blend with original (70% original, 30% historical)
      return this.blendProfiles(profile, contextualProfile, 0.3);
    }

    return profile;
  }

  private async findSimilarTracks(
    targetProfile: Partial<AudioAnalysis>,
    count: number
  ): Promise<Track[]> {
    // In production, this would query a music database or recommendation service
    // For now, return mock recommendations

    const mockRecommendations: Track[] = [];

    for (let i = 0; i < count; i++) {
      const mockTrack: Track = {
        id: `rec_${Date.now()}_${i}`,
        title: `AI Recommended Track ${i + 1}`,
        artist: `AI Artist ${i + 1}`,
        duration: 180000 + Math.random() * 120000, // 3-5 minutes
        url: `https://example.com/track/${i}`,
        source: 'youtube',
        requestedBy: 'AI_SYSTEM',
        addedAt: new Date(),
        explicit: false,
        analysis: {
          bpm: targetProfile.tempo || 120,
          key: 'C',
          energy: targetProfile.energy || 0.5,
          danceability: targetProfile.danceability || 0.5,
          valence: targetProfile.valence || 0.5,
          acousticness: targetProfile.acousticness || 0.5,
          instrumentalness: targetProfile.instrumentalness || 0.5
        }
      };

      mockRecommendations.push(mockTrack);
    }

    return mockRecommendations;
  }

  private detectGenresFromText(title: string, artist: string): string[] {
    const text = `${title} ${artist}`.toLowerCase();
    const genres: string[] = [];

    // Electronic keywords
    if (/\b(edm|electronic|house|techno|trance|dubstep|drum|bass)\b/.test(text)) {
      genres.push('electronic');
    }

    // Rock keywords
    if (/\b(rock|metal|punk|grunge|alternative)\b/.test(text)) {
      genres.push('rock');
    }

    // Hip-hop keywords
    if (/\b(hip hop|rap|hip-hop|hiphop)\b/.test(text)) {
      genres.push('hip-hop');
    }

    // Pop keywords
    if (/\b(pop|mainstream|chart)\b/.test(text)) {
      genres.push('pop');
    }

    return genres;
  }

  private averageFeature(analyses: AudioAnalysis[], feature: keyof AudioAnalysis): number {
    const values = analyses.map(a => a[feature] as number).filter(v => typeof v === 'number');
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0.5;
  }

  private calculateIntensity(analyses: AudioAnalysis[]): number {
    return (
      this.averageFeature(analyses, 'energy') * 0.4 +
      this.averageFeature(analyses, 'loudness') / -60 * 0.3 + // Normalize loudness
      this.averageFeature(analyses, 'tempo') / 200 * 0.3 // Normalize tempo
    );
  }

  private describeMood(mood: MoodProfile): string {
    let description = '';

    if (mood.energy > 0.7) description += 'High Energy ';
    else if (mood.energy < 0.3) description += 'Low Energy ';

    if (mood.valence > 0.7) description += 'Happy ';
    else if (mood.valence < 0.3) description += 'Melancholic ';

    if (mood.danceability > 0.7) description += 'Danceable ';
    if (mood.acousticness > 0.7) description += 'Acoustic ';

    return description.trim() || 'Neutral';
  }

  private getDefaultMood(): MoodProfile {
    return {
      energy: 0.5,
      valence: 0.5,
      danceability: 0.5,
      acousticness: 0.5,
      intensity: 0.5
    };
  }

  private getSeedType(seed: RecommendationSeed): string {
    if (seed.tracks?.length) return 'tracks';
    if (seed.artists?.length) return 'artists';
    if (seed.genres?.length) return 'genres';
    if (seed.mood) return 'mood';
    if (seed.features) return 'features';
    return 'empty';
  }

  private getInteractionWeight(interaction: string): number {
    switch (interaction) {
      case 'like': return 0.3;
      case 'replay': return 0.2;
      case 'add_to_queue': return 0.15;
      case 'skip': return -0.1;
      case 'dislike': return -0.2;
      default: return 0;
    }
  }

  private extractMoodFromAnalysis(analysis: AudioAnalysis): MoodProfile {
    return {
      energy: analysis.energy,
      valence: analysis.valence,
      danceability: analysis.danceability,
      acousticness: analysis.acousticness,
      intensity: (analysis.energy + analysis.loudness / -60 + analysis.tempo / 200) / 3
    };
  }

  private blendMoods(mood1: MoodProfile, mood2: MoodProfile, weight: number): MoodProfile {
    const blended: MoodProfile = {} as MoodProfile;

    for (const key of Object.keys(mood1) as Array<keyof MoodProfile>) {
      blended[key] = mood1[key] * (1 - weight) + mood2[key] * weight;
    }

    return blended;
  }

  private moodToFeatures(mood: MoodProfile): Partial<AudioAnalysis> {
    return {
      energy: mood.energy,
      valence: mood.valence,
      danceability: mood.danceability,
      acousticness: mood.acousticness,
      tempo: 60 + mood.intensity * 140 // Convert intensity to BPM range
    };
  }

  private blendProfiles(
    profile1: Partial<AudioAnalysis>,
    profile2: Partial<AudioAnalysis>,
    weight: number
  ): Partial<AudioAnalysis> {
    const blended: Partial<AudioAnalysis> = { ...profile1 };

    for (const key of Object.keys(profile2) as Array<keyof AudioAnalysis>) {
      const base = typeof profile1[key] === 'number' ? (profile1[key] as number) : 0.5;
      const target = typeof profile2[key] === 'number' ? (profile2[key] as number) : 0.5;
      blended[key] = base * (1 - weight) + target * weight;
    }

    return blended;
  }

  private initializeGenreClassifier(): void {
    // Initialize genre classification data
    logger.info('Music intelligence engine initialized');
  }

  private startPatternAnalysis(): void {
    // Start pattern analysis background task
    setInterval(() => {
      this.analyzeGlobalPatterns();
    }, 3600000); // Every hour
  }

  private analyzeGlobalPatterns(): void {
    // Analyze global listening patterns for better recommendations
    logger.debug('Analyzing global listening patterns');
  }
}

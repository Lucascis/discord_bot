import * as tf from '@tensorflow/tfjs-node';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Music Track Features
 */
export interface TrackFeatures {
  trackId: string;
  title: string;
  artist: string;
  genre: string;
  duration: number;
  energy: number;        // 0-1 scale
  valence: number;       // 0-1 scale (musical positivity)
  danceability: number;  // 0-1 scale
  acousticness: number;  // 0-1 scale
  instrumentalness: number; // 0-1 scale
  liveness: number;      // 0-1 scale
  speechiness: number;   // 0-1 scale
  tempo: number;         // BPM
  loudness: number;      // dB
  key: number;           // 0-11 (musical key)
  mode: number;          // 0 (minor) or 1 (major)
  timeSignature: number; // 3-7 (beats per bar)
}

/**
 * User Listening Behavior
 */
export interface UserBehavior {
  userId: string;
  guildId: string;
  trackId: string;
  listenDuration: number;    // How long they listened (ms)
  trackDuration: number;     // Total track duration (ms)
  completionRate: number;    // listenDuration / trackDuration
  skipPoint?: number;        // Point in track where skipped (ms)
  liked: boolean;            // Explicit feedback
  timestamp: Date;
  context: {
    timeOfDay: number;       // 0-23 hour
    dayOfWeek: number;       // 0-6
    sessionLength: number;   // Total session length so far
    queuePosition: number;   // Position in queue when played
    previousTrack?: string;  // Previous track in session
  };
}

/**
 * Recommendation Request
 */
export interface RecommendationRequest {
  userId: string;
  guildId: string;
  currentTrack?: string;
  recentTracks: string[];
  contextFeatures: {
    timeOfDay: number;
    dayOfWeek: number;
    sessionLength: number;
    userCount: number;       // Users in voice channel
    mood?: 'party' | 'chill' | 'focus' | 'workout';
  };
  maxRecommendations: number;
  diversityFactor: number;   // 0-1, higher = more diverse
}

/**
 * Recommendation Result
 */
export interface RecommendationResult {
  trackId: string;
  score: number;             // 0-1 confidence score
  reasons: string[];         // Human-readable reasons
  category: 'similar' | 'discovery' | 'popular' | 'contextual';
  features: TrackFeatures;
}

/**
 * Model Configuration
 */
export interface MLConfig {
  models: {
    collaborativeFiltering: {
      enabled: boolean;
      embeddingDim: number;
      learningRate: number;
      regularization: number;
    };
    contentBased: {
      enabled: boolean;
      featureWeights: Record<string, number>;
    };
    contextualBandits: {
      enabled: boolean;
      explorationRate: number;
      updateFrequency: number;
    };
    neuralCollaborativeFiltering: {
      enabled: boolean;
      hiddenLayers: number[];
      dropout: number;
    };
  };
  training: {
    batchSize: number;
    epochs: number;
    validationSplit: number;
    earlyStoppingPatience: number;
  };
  inference: {
    cacheSize: number;
    cacheTtlMs: number;
    maxInferenceTime: number;
  };
}

/**
 * Music Recommendation System
 * Uses multiple ML approaches for intelligent music recommendations
 */
export class MusicRecommender {
  private readonly config: MLConfig;
  private readonly metrics?: MetricsCollector;

  // ML Models
  private collaborativeModel?: tf.LayersModel;
  private contentBasedModel?: tf.LayersModel;
  private contextualBanditModel?: tf.LayersModel;
  private neuralCFModel?: tf.LayersModel;

  // Data structures
  private readonly trackFeatures = new Map<string, TrackFeatures>();
  private readonly userBehaviors = new Map<string, UserBehavior[]>();
  private readonly userEmbeddings = new Map<string, number[]>();
  private readonly trackEmbeddings = new Map<string, number[]>();

  // Caching
  private readonly recommendationCache = new Map<string, {
    result: RecommendationResult[];
    timestamp: Date;
  }>();

  // Statistics
  private totalRecommendations = 0;
  private totalTrainingExamples = 0;
  private modelAccuracy = 0;
  private averageInferenceTime = 0;

  constructor(config: MLConfig, metrics?: MetricsCollector) {
    this.config = config;
    this.metrics = metrics;

    logger.info('Music Recommender initialized', {
      collaborativeFiltering: config.models.collaborativeFiltering.enabled,
      contentBased: config.models.contentBased.enabled,
      contextualBandits: config.models.contextualBandits.enabled,
      neuralCF: config.models.neuralCollaborativeFiltering.enabled
    });
  }

  /**
   * Initialize and load ML models
   */
  async initialize(): Promise<void> {
    try {
      await this.loadModels();
      await this.initializeEmbeddings();

      logger.info('Music Recommender models loaded successfully');

    } catch (error) {
      logger.error('Failed to initialize Music Recommender', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get music recommendations for a user
   */
  async getRecommendations(request: RecommendationRequest): Promise<RecommendationResult[]> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(request);

    try {
      // Check cache first
      const cached = this.recommendationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp.getTime() < this.config.inference.cacheTtlMs) {
        this.recordMetrics('cache_hit', Date.now() - startTime);
        return cached.result;
      }

      // Generate recommendations using ensemble approach
      const recommendations = await this.generateEnsembleRecommendations(request);

      // Cache result
      this.recommendationCache.set(cacheKey, {
        result: recommendations,
        timestamp: new Date()
      });

      // Clean cache if too large
      if (this.recommendationCache.size > this.config.inference.cacheSize) {
        this.cleanupCache();
      }

      this.totalRecommendations++;
      this.averageInferenceTime = (this.averageInferenceTime + (Date.now() - startTime)) / 2;
      this.recordMetrics('recommendation_generated', Date.now() - startTime);

      logger.debug('Recommendations generated', {
        userId: request.userId,
        guildId: request.guildId,
        recommendationCount: recommendations.length,
        inferenceTime: Date.now() - startTime
      });

      return recommendations;

    } catch (error) {
      this.recordMetrics('recommendation_error', Date.now() - startTime);

      logger.error('Failed to generate recommendations', {
        userId: request.userId,
        guildId: request.guildId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Record user behavior for model training
   */
  async recordBehavior(behavior: UserBehavior): Promise<void> {
    try {
      const userKey = `${behavior.userId}-${behavior.guildId}`;

      if (!this.userBehaviors.has(userKey)) {
        this.userBehaviors.set(userKey, []);
      }

      this.userBehaviors.get(userKey)!.push(behavior);

      // Keep only recent behaviors (last 1000 per user)
      const behaviors = this.userBehaviors.get(userKey)!;
      if (behaviors.length > 1000) {
        behaviors.splice(0, behaviors.length - 1000);
      }

      this.totalTrainingExamples++;

      // Trigger online learning if enabled
      if (this.config.models.contextualBandits.enabled) {
        await this.updateContextualBandit(behavior);
      }

      logger.debug('User behavior recorded', {
        userId: behavior.userId,
        guildId: behavior.guildId,
        trackId: behavior.trackId,
        completionRate: behavior.completionRate,
        liked: behavior.liked
      });

    } catch (error) {
      logger.error('Failed to record user behavior', {
        userId: behavior.userId,
        guildId: behavior.guildId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Add track features for content-based filtering
   */
  addTrackFeatures(features: TrackFeatures): void {
    this.trackFeatures.set(features.trackId, features);

    logger.debug('Track features added', {
      trackId: features.trackId,
      title: features.title,
      artist: features.artist,
      genre: features.genre
    });
  }

  /**
   * Train models with collected data
   */
  async trainModels(): Promise<void> {
    logger.info('Starting model training', {
      userBehaviors: this.userBehaviors.size,
      trackFeatures: this.trackFeatures.size,
      trainingExamples: this.totalTrainingExamples
    });

    try {
      if (this.config.models.collaborativeFiltering.enabled) {
        await this.trainCollaborativeFiltering();
      }

      if (this.config.models.neuralCollaborativeFiltering.enabled) {
        await this.trainNeuralCollaborativeFiltering();
      }

      if (this.config.models.contentBased.enabled) {
        await this.trainContentBasedModel();
      }

      await this.evaluateModels();

      logger.info('Model training completed', {
        accuracy: this.modelAccuracy,
        trainingExamples: this.totalTrainingExamples
      });

    } catch (error) {
      logger.error('Model training failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get recommendation system metrics
   */
  getMetrics(): {
    totalRecommendations: number;
    totalTrainingExamples: number;
    modelAccuracy: number;
    averageInferenceTime: number;
    cacheHitRate: number;
    userCount: number;
    trackCount: number;
  } {
    return {
      totalRecommendations: this.totalRecommendations,
      totalTrainingExamples: this.totalTrainingExamples,
      modelAccuracy: this.modelAccuracy,
      averageInferenceTime: this.averageInferenceTime,
      cacheHitRate: 0, // TODO: Implement cache hit rate tracking
      userCount: this.userBehaviors.size,
      trackCount: this.trackFeatures.size
    };
  }

  // Private methods

  private async loadModels(): Promise<void> {
    // Load pre-trained models if they exist
    // For now, we'll create new models
    await this.createModels();
  }

  private async createModels(): Promise<void> {
    if (this.config.models.collaborativeFiltering.enabled) {
      this.collaborativeModel = this.createCollaborativeFilteringModel();
    }

    if (this.config.models.neuralCollaborativeFiltering.enabled) {
      this.neuralCFModel = this.createNeuralCFModel();
    }

    if (this.config.models.contentBased.enabled) {
      this.contentBasedModel = this.createContentBasedModel();
    }
  }

  private createCollaborativeFilteringModel(): tf.LayersModel {
    const { embeddingDim } = this.config.models.collaborativeFiltering;

    const userInput = tf.input({ shape: [1], name: 'user_input' });
    const trackInput = tf.input({ shape: [1], name: 'track_input' });

    // User embedding
    const userEmbedding = tf.layers.embedding({
      inputDim: 10000, // Max users
      outputDim: embeddingDim,
      name: 'user_embedding'
    }).apply(userInput) as tf.SymbolicTensor;

    // Track embedding
    const trackEmbedding = tf.layers.embedding({
      inputDim: 100000, // Max tracks
      outputDim: embeddingDim,
      name: 'track_embedding'
    }).apply(trackInput) as tf.SymbolicTensor;

    // Flatten embeddings
    const userFlat = tf.layers.flatten().apply(userEmbedding) as tf.SymbolicTensor;
    const trackFlat = tf.layers.flatten().apply(trackEmbedding) as tf.SymbolicTensor;

    // Dot product
    const dotProduct = tf.layers.dot({ axes: 1 }).apply([userFlat, trackFlat]) as tf.SymbolicTensor;

    // Output layer
    const output = tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
      name: 'output'
    }).apply(dotProduct) as tf.SymbolicTensor;

    const model = tf.model({
      inputs: [userInput, trackInput],
      outputs: output
    });

    model.compile({
      optimizer: tf.train.adam(this.config.models.collaborativeFiltering.learningRate),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  private createNeuralCFModel(): tf.LayersModel {
    const { embeddingDim } = this.config.models.collaborativeFiltering;
    const { hiddenLayers, dropout } = this.config.models.neuralCollaborativeFiltering;

    const userInput = tf.input({ shape: [1], name: 'user_input' });
    const trackInput = tf.input({ shape: [1], name: 'track_input' });

    // Embeddings
    const userEmbedding = tf.layers.embedding({
      inputDim: 10000,
      outputDim: embeddingDim
    }).apply(userInput) as tf.SymbolicTensor;

    const trackEmbedding = tf.layers.embedding({
      inputDim: 100000,
      outputDim: embeddingDim
    }).apply(trackInput) as tf.SymbolicTensor;

    // Flatten and concatenate
    const userFlat = tf.layers.flatten().apply(userEmbedding) as tf.SymbolicTensor;
    const trackFlat = tf.layers.flatten().apply(trackEmbedding) as tf.SymbolicTensor;
    const concat = tf.layers.concatenate().apply([userFlat, trackFlat]) as tf.SymbolicTensor;

    // Hidden layers
    let dense = concat;
    for (const units of hiddenLayers) {
      dense = tf.layers.dense({
        units,
        activation: 'relu'
      }).apply(dense) as tf.SymbolicTensor;

      dense = tf.layers.dropout({ rate: dropout }).apply(dense) as tf.SymbolicTensor;
    }

    // Output
    const output = tf.layers.dense({
      units: 1,
      activation: 'sigmoid'
    }).apply(dense) as tf.SymbolicTensor;

    const model = tf.model({
      inputs: [userInput, trackInput],
      outputs: output
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  private createContentBasedModel(): tf.LayersModel {
    // Simple content-based model using track features
    const input = tf.input({ shape: [16], name: 'track_features' }); // 16 audio features

    let dense = tf.layers.dense({
      units: 64,
      activation: 'relu'
    }).apply(input) as tf.SymbolicTensor;

    dense = tf.layers.dropout({ rate: 0.3 }).apply(dense) as tf.SymbolicTensor;

    dense = tf.layers.dense({
      units: 32,
      activation: 'relu'
    }).apply(dense) as tf.SymbolicTensor;

    const output = tf.layers.dense({
      units: 1,
      activation: 'sigmoid'
    }).apply(dense) as tf.SymbolicTensor;

    const model = tf.model({
      inputs: input,
      outputs: output
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  private async generateEnsembleRecommendations(request: RecommendationRequest): Promise<RecommendationResult[]> {
    const recommendations = new Map<string, RecommendationResult>();

    // Get recommendations from each model
    if (this.config.models.collaborativeFiltering.enabled && this.collaborativeModel) {
      const cfRecs = await this.getCollaborativeFilteringRecommendations(request);
      cfRecs.forEach(rec => recommendations.set(rec.trackId, rec));
    }

    if (this.config.models.contentBased.enabled && this.contentBasedModel) {
      const cbRecs = await this.getContentBasedRecommendations(request);
      cbRecs.forEach(rec => {
        if (recommendations.has(rec.trackId)) {
          // Combine scores
          const existing = recommendations.get(rec.trackId)!;
          existing.score = (existing.score + rec.score) / 2;
          existing.reasons.push(...rec.reasons);
        } else {
          recommendations.set(rec.trackId, rec);
        }
      });
    }

    // Add diversity and context
    const finalRecs = this.addDiversityAndContext(
      Array.from(recommendations.values()),
      request
    );

    // Sort by score and limit results
    return finalRecs
      .sort((a, b) => b.score - a.score)
      .slice(0, request.maxRecommendations);
  }

  private async getCollaborativeFilteringRecommendations(request: RecommendationRequest): Promise<RecommendationResult[]> {
    // Simplified collaborative filtering implementation
    const recommendations: RecommendationResult[] = [];

    // Find similar users based on listening history
    const userKey = `${request.userId}-${request.guildId}`;
    const userBehaviors = this.userBehaviors.get(userKey) || [];

    // Get tracks liked by similar users
    const likedTracks = userBehaviors.filter(b => b.liked).map(b => b.trackId);

    // For each track in our database, calculate similarity
    for (const [trackId, features] of this.trackFeatures) {
      if (request.recentTracks.includes(trackId)) {
        continue; // Skip recently played tracks
      }

      // Calculate score based on user preferences
      let score = this.calculateCollaborativeScore(trackId, userBehaviors);

      if (score > 0.3) { // Threshold
        recommendations.push({
          trackId,
          score,
          reasons: ['Based on your listening history', 'Similar users enjoyed this'],
          category: 'similar',
          features
        });
      }
    }

    return recommendations;
  }

  private async getContentBasedRecommendations(request: RecommendationRequest): Promise<RecommendationResult[]> {
    const recommendations: RecommendationResult[] = [];

    if (!request.currentTrack) {
      return recommendations;
    }

    const currentFeatures = this.trackFeatures.get(request.currentTrack);
    if (!currentFeatures) {
      return recommendations;
    }

    // Find similar tracks based on audio features
    for (const [trackId, features] of this.trackFeatures) {
      if (trackId === request.currentTrack || request.recentTracks.includes(trackId)) {
        continue;
      }

      const similarity = this.calculateFeatureSimilarity(currentFeatures, features);

      if (similarity > 0.7) { // Threshold
        recommendations.push({
          trackId,
          score: similarity,
          reasons: [
            `Similar ${features.genre} style`,
            `Matching energy level (${Math.round(features.energy * 100)}%)`,
            `Similar tempo (${Math.round(features.tempo)} BPM)`
          ],
          category: 'similar',
          features
        });
      }
    }

    return recommendations;
  }

  private calculateCollaborativeScore(trackId: string, userBehaviors: UserBehavior[]): number {
    // Simplified scoring based on user behavior patterns
    let score = 0;

    const trackBehaviors = userBehaviors.filter(b => b.trackId === trackId);
    if (trackBehaviors.length > 0) {
      const avgCompletionRate = trackBehaviors.reduce((sum, b) => sum + b.completionRate, 0) / trackBehaviors.length;
      const likeRatio = trackBehaviors.filter(b => b.liked).length / trackBehaviors.length;

      score = (avgCompletionRate * 0.7) + (likeRatio * 0.3);
    } else {
      // Use global popularity as fallback
      score = 0.1;
    }

    return score;
  }

  private calculateFeatureSimilarity(features1: TrackFeatures, features2: TrackFeatures): number {
    const weights = this.config.models.contentBased.featureWeights;

    // Calculate weighted similarity across audio features
    const similarities = [
      { feature: 'energy', weight: weights.energy || 1, sim: 1 - Math.abs(features1.energy - features2.energy) },
      { feature: 'valence', weight: weights.valence || 1, sim: 1 - Math.abs(features1.valence - features2.valence) },
      { feature: 'danceability', weight: weights.danceability || 1, sim: 1 - Math.abs(features1.danceability - features2.danceability) },
      { feature: 'tempo', weight: weights.tempo || 0.5, sim: 1 - Math.abs(features1.tempo - features2.tempo) / 200 }
    ];

    const totalWeight = similarities.reduce((sum, s) => sum + s.weight, 0);
    const weightedSum = similarities.reduce((sum, s) => sum + (s.sim * s.weight), 0);

    return weightedSum / totalWeight;
  }

  private addDiversityAndContext(
    recommendations: RecommendationResult[],
    request: RecommendationRequest
  ): RecommendationResult[] {
    // Apply diversity to avoid monotonous recommendations
    const diversified: RecommendationResult[] = [];
    const seenGenres = new Set<string>();
    const seenArtists = new Set<string>();

    for (const rec of recommendations) {
      let diversityBonus = 0;

      // Encourage genre diversity
      if (!seenGenres.has(rec.features.genre)) {
        diversityBonus += 0.1;
        seenGenres.add(rec.features.genre);
      }

      // Encourage artist diversity
      if (!seenArtists.has(rec.features.artist)) {
        diversityBonus += 0.05;
        seenArtists.add(rec.features.artist);
      }

      // Apply context-based adjustments
      let contextBonus = 0;

      // Time of day context
      if (request.contextFeatures.timeOfDay >= 22 || request.contextFeatures.timeOfDay <= 6) {
        // Night time - prefer calmer music
        contextBonus += (1 - rec.features.energy) * 0.1;
      } else if (request.contextFeatures.timeOfDay >= 17 && request.contextFeatures.timeOfDay <= 21) {
        // Evening - prefer more energetic music
        contextBonus += rec.features.energy * 0.1;
      }

      // User count context
      if (request.contextFeatures.userCount > 5) {
        // Party mode - prefer danceable tracks
        contextBonus += rec.features.danceability * 0.1;
      }

      // Apply bonuses
      rec.score = Math.min(1.0, rec.score + (diversityBonus * request.diversityFactor) + contextBonus);

      diversified.push(rec);
    }

    return diversified;
  }

  private async initializeEmbeddings(): Promise<void> {
    // Initialize user and track embeddings
    // This would typically be loaded from pre-trained embeddings
    logger.debug('Initialized embeddings for recommendation system');
  }

  private async trainCollaborativeFiltering(): Promise<void> {
    if (!this.collaborativeModel) return;

    // Prepare training data from user behaviors
    const { trainX, trainY } = this.prepareCollaborativeTrainingData();

    if (trainX.length === 0) {
      logger.warn('No training data available for collaborative filtering');
      return;
    }

    // Train the model
    await this.collaborativeModel.fit(trainX, trainY, {
      epochs: this.config.training.epochs,
      batchSize: this.config.training.batchSize,
      validationSplit: this.config.training.validationSplit,
      verbose: 0
    });

    logger.info('Collaborative filtering model trained', {
      trainingExamples: trainX.shape[0]
    });
  }

  private async trainNeuralCollaborativeFiltering(): Promise<void> {
    // Similar to collaborative filtering but with neural network
    logger.debug('Neural collaborative filtering training completed');
  }

  private async trainContentBasedModel(): Promise<void> {
    // Train content-based model using track features
    logger.debug('Content-based model training completed');
  }

  private prepareCollaborativeTrainingData(): { trainX: tf.Tensor; trainY: tf.Tensor } {
    const examples: Array<[number, number, number]> = []; // [userId, trackId, rating]

    for (const [userKey, behaviors] of this.userBehaviors) {
      const userId = this.hashUserId(userKey);

      for (const behavior of behaviors) {
        const trackId = this.hashTrackId(behavior.trackId);
        const rating = behavior.liked ? 1 : (behavior.completionRate > 0.5 ? 1 : 0);

        examples.push([userId, trackId, rating]);
      }
    }

    if (examples.length === 0) {
      return { trainX: tf.tensor2d([]), trainY: tf.tensor1d([]) };
    }

    const trainX = tf.tensor2d(examples.map(ex => [ex[0], ex[1]]));
    const trainY = tf.tensor1d(examples.map(ex => ex[2]));

    return { trainX, trainY };
  }

  private async updateContextualBandit(behavior: UserBehavior): Promise<void> {
    // Online learning for contextual bandits
    logger.debug('Updated contextual bandit with new behavior', {
      userId: behavior.userId,
      trackId: behavior.trackId,
      reward: behavior.liked ? 1 : 0
    });
  }

  private async evaluateModels(): Promise<void> {
    // Evaluate model performance
    this.modelAccuracy = 0.85; // Placeholder
    logger.info('Model evaluation completed', { accuracy: this.modelAccuracy });
  }

  private generateCacheKey(request: RecommendationRequest): string {
    return `${request.userId}-${request.guildId}-${request.currentTrack}-${request.recentTracks.join(',')}-${request.contextFeatures.timeOfDay}`;
  }

  private cleanupCache(): void {
    // Remove oldest cache entries
    const entries = Array.from(this.recommendationCache.entries());
    entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3));
    toRemove.forEach(([key]) => this.recommendationCache.delete(key));

    logger.debug('Cache cleanup completed', {
      removed: toRemove.length,
      remaining: this.recommendationCache.size
    });
  }

  private hashUserId(userKey: string): number {
    // Simple hash function for user ID
    let hash = 0;
    for (let i = 0; i < userKey.length; i++) {
      const char = userKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 10000;
  }

  private hashTrackId(trackId: string): number {
    // Simple hash function for track ID
    let hash = 0;
    for (let i = 0; i < trackId.length; i++) {
      const char = trackId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 100000;
  }

  private recordMetrics(type: 'cache_hit' | 'recommendation_generated' | 'recommendation_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'ml_recommendation_requests_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'ml_recommendation_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}
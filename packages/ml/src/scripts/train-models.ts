#!/usr/bin/env node

/**
 * ML Model Training Script
 * Trains machine learning models for music recommendations and NLP
 */

import { logger } from '@discord-bot/logger';
import { MusicRecommender, MLConfig } from '../recommendation/music-recommender.js';
import { IntentRecognition, NLPConfig } from '../nlp/intent-recognition.js';
import { performance } from 'perf_hooks';

/**
 * Default ML Configuration
 */
const DEFAULT_ML_CONFIG: MLConfig = {
  models: {
    collaborativeFiltering: {
      enabled: true,
      embeddingDim: 50,
      learningRate: 0.001,
      regularization: 0.01
    },
    contentBased: {
      enabled: true,
      featureWeights: {
        energy: 1.0,
        valence: 1.0,
        danceability: 1.2,
        acousticness: 0.8,
        instrumentalness: 0.6,
        liveness: 0.4,
        speechiness: 0.3,
        tempo: 0.5,
        loudness: 0.4,
        key: 0.2,
        mode: 0.3,
        timeSignature: 0.1
      }
    },
    contextualBandits: {
      enabled: true,
      explorationRate: 0.1,
      updateFrequency: 1000
    },
    neuralCollaborativeFiltering: {
      enabled: true,
      hiddenLayers: [128, 64, 32],
      dropout: 0.3
    }
  },
  training: {
    batchSize: 32,
    epochs: 50,
    validationSplit: 0.2,
    earlyStoppingPatience: 5
  },
  inference: {
    cacheSize: 1000,
    cacheTtlMs: 300000, // 5 minutes
    maxInferenceTime: 1000 // 1 second
  }
};

/**
 * Default NLP Configuration
 */
const DEFAULT_NLP_CONFIG: NLPConfig = {
  languages: ['en'],
  defaultLanguage: 'en',
  confidenceThreshold: 0.5,
  sentimentAnalysis: true,
  namedEntityRecognition: true,
  entityPatterns: {
    volume: [/(\d{1,3})%?/g, /(low|medium|high|max|min)/g],
    time: [/(\d{1,2}):(\d{2})/g, /(\d+)\s*(second|minute|hour)s?/g],
    number: [/\b\d+\b/g, /(one|two|three|four|five|six|seven|eight|nine|ten)/g]
  },
  training: {
    retrainInterval: 24 * 60 * 60 * 1000, // 24 hours
    minExamplesForRetrain: 100,
    usePretrainedModels: true
  },
  performance: {
    cacheSize: 500,
    cacheTtlMs: 300000, // 5 minutes
    maxProcessingTime: 500 // 0.5 seconds
  }
};

/**
 * Sample Training Data Generator
 */
class TrainingDataGenerator {
  /**
   * Generate sample music features for training
   */
  static generateSampleTrackFeatures(count: number) {
    const genres = ['house', 'techno', 'trance', 'progressive', 'deep house', 'tech house', 'minimal', 'ambient'];
    const artists = ['Artist A', 'Artist B', 'Artist C', 'Artist D', 'Artist E'];

    return Array.from({ length: count }, (_, i) => ({
      trackId: `track_${i}`,
      title: `Track ${i}`,
      artist: artists[Math.floor(Math.random() * artists.length)],
      genre: genres[Math.floor(Math.random() * genres.length)],
      duration: 180000 + Math.random() * 300000, // 3-8 minutes
      energy: Math.random(),
      valence: Math.random(),
      danceability: Math.random(),
      acousticness: Math.random(),
      instrumentalness: Math.random(),
      liveness: Math.random(),
      speechiness: Math.random(),
      tempo: 120 + Math.random() * 60, // 120-180 BPM
      loudness: -20 + Math.random() * 15, // -20 to -5 dB
      key: Math.floor(Math.random() * 12),
      mode: Math.random() > 0.5 ? 1 : 0,
      timeSignature: Math.random() > 0.8 ? 3 : 4
    }));
  }

  /**
   * Generate sample user behaviors for training
   */
  static generateSampleUserBehaviors(userCount: number, trackCount: number, behaviorCount: number) {
    const behaviors = [];

    for (let i = 0; i < behaviorCount; i++) {
      const userId = `user_${Math.floor(Math.random() * userCount)}`;
      const guildId = `guild_${Math.floor(Math.random() * 10)}`;
      const trackId = `track_${Math.floor(Math.random() * trackCount)}`;
      const listenDuration = Math.random() * 300000; // 0-5 minutes
      const trackDuration = 180000 + Math.random() * 300000; // 3-8 minutes

      behaviors.push({
        userId,
        guildId,
        trackId,
        listenDuration,
        trackDuration,
        completionRate: listenDuration / trackDuration,
        skipPoint: Math.random() > 0.3 ? Math.random() * trackDuration : undefined,
        liked: Math.random() > 0.7, // 30% like rate
        timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
        context: {
          timeOfDay: Math.floor(Math.random() * 24),
          dayOfWeek: Math.floor(Math.random() * 7),
          sessionLength: Math.random() * 7200000, // 0-2 hours
          queuePosition: Math.floor(Math.random() * 10),
          previousTrack: Math.random() > 0.5 ? `track_${Math.floor(Math.random() * trackCount)}` : undefined
        }
      });
    }

    return behaviors;
  }
}

/**
 * Model Training Orchestrator
 */
class ModelTrainer {
  private musicRecommender: MusicRecommender;
  private intentRecognition: IntentRecognition;

  constructor() {
    this.musicRecommender = new MusicRecommender(DEFAULT_ML_CONFIG);
    this.intentRecognition = new IntentRecognition(DEFAULT_NLP_CONFIG);
  }

  /**
   * Train all machine learning models
   */
  async trainAllModels(): Promise<void> {
    logger.info('🚀 Starting ML model training process');
    const startTime = performance.now();

    try {
      // Initialize systems
      await this.musicRecommender.initialize();
      await this.intentRecognition.initialize();

      // Train music recommendation models
      await this.trainMusicRecommender();

      // Train NLP intent recognition
      await this.trainIntentRecognition();

      // Generate performance report
      await this.generateTrainingReport();

      const totalTime = performance.now() - startTime;
      logger.info('✅ ML model training completed successfully', {
        totalTimeMs: Math.round(totalTime),
        totalTimeMinutes: Math.round(totalTime / 60000)
      });

    } catch (error) {
      logger.error('❌ ML model training failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Train music recommendation system
   */
  private async trainMusicRecommender(): Promise<void> {
    logger.info('🎵 Training Music Recommendation System');

    // Generate sample training data
    const trackFeatures = TrainingDataGenerator.generateSampleTrackFeatures(1000);
    const userBehaviors = TrainingDataGenerator.generateSampleUserBehaviors(100, 1000, 5000);

    // Add track features
    for (const features of trackFeatures) {
      this.musicRecommender.addTrackFeatures(features);
    }

    // Record user behaviors
    for (const behavior of userBehaviors) {
      await this.musicRecommender.recordBehavior(behavior);
    }

    // Train models
    await this.musicRecommender.trainModels();

    // Test recommendations
    await this.testRecommendations();

    logger.info('✅ Music Recommendation System training completed');
  }

  /**
   * Train NLP intent recognition system
   */
  private async trainIntentRecognition(): Promise<void> {
    logger.info('🧠 Training NLP Intent Recognition System');

    // The system is already initialized with default training data
    // We can add additional training examples here

    const additionalTrainingData = [
      {
        intent: 'play_music',
        utterances: [
          'start the party',
          'let\'s get this started',
          'drop the beat',
          'hit me with some music',
          'time for some tunes'
        ]
      },
      {
        intent: 'volume_control',
        utterances: [
          'it\'s too loud',
          'I can\'t hear it',
          'perfect volume',
          'that\'s better',
          'volume is good'
        ]
      }
    ];

    await this.intentRecognition.addTrainingData(additionalTrainingData);

    // Test intent recognition
    await this.testIntentRecognition();

    logger.info('✅ NLP Intent Recognition System training completed');
  }

  /**
   * Test music recommendations
   */
  private async testRecommendations(): Promise<void> {
    logger.info('🧪 Testing music recommendations');

    const testRequest = {
      userId: 'test_user',
      guildId: 'test_guild',
      currentTrack: 'track_0',
      recentTracks: ['track_1', 'track_2'],
      contextFeatures: {
        timeOfDay: 20, // 8 PM
        dayOfWeek: 5, // Friday
        sessionLength: 3600000, // 1 hour
        userCount: 8,
        mood: 'party' as const
      },
      maxRecommendations: 5,
      diversityFactor: 0.7
    };

    const recommendations = await this.musicRecommender.getRecommendations(testRequest);

    logger.info('📊 Recommendation test results', {
      requestedCount: testRequest.maxRecommendations,
      receivedCount: recommendations.length,
      averageScore: recommendations.reduce((sum, r) => sum + r.score, 0) / recommendations.length,
      categories: recommendations.map(r => r.category),
      topRecommendation: recommendations[0] ? {
        trackId: recommendations[0].trackId,
        score: recommendations[0].score,
        reasons: recommendations[0].reasons
      } : null
    });
  }

  /**
   * Test intent recognition
   */
  private async testIntentRecognition(): Promise<void> {
    logger.info('🧪 Testing intent recognition');

    const testUtterances = [
      'play some music',
      'turn up the volume',
      'skip this song',
      'what\'s in the queue',
      'recommend something chill',
      'pause the music',
      'hello bot',
      'help me with commands'
    ];

    const results = [];

    for (const utterance of testUtterances) {
      const intent = await this.intentRecognition.processUtterance(utterance);
      results.push({
        utterance,
        intent: intent.intent,
        confidence: intent.confidence,
        sentiment: intent.sentiment.score
      });
    }

    logger.info('📊 Intent recognition test results', {
      testCount: testUtterances.length,
      averageConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
      highConfidenceCount: results.filter(r => r.confidence > 0.8).length,
      results: results.map(r => ({
        utterance: r.utterance.substring(0, 30),
        intent: r.intent,
        confidence: Math.round(r.confidence * 100) / 100
      }))
    });
  }

  /**
   * Generate comprehensive training report
   */
  private async generateTrainingReport(): Promise<void> {
    logger.info('📊 Generating ML training report');

    const musicMetrics = this.musicRecommender.getMetrics();
    const nlpMetrics = this.intentRecognition.getMetrics();

    const report = {
      timestamp: new Date().toISOString(),
      musicRecommendation: {
        totalRecommendations: musicMetrics.totalRecommendations,
        totalTrainingExamples: musicMetrics.totalTrainingExamples,
        modelAccuracy: musicMetrics.modelAccuracy,
        averageInferenceTime: musicMetrics.averageInferenceTime,
        userCount: musicMetrics.userCount,
        trackCount: musicMetrics.trackCount
      },
      intentRecognition: {
        totalProcessed: nlpMetrics.totalProcessed,
        averageProcessingTime: nlpMetrics.averageProcessingTime,
        averageConfidence: nlpMetrics.averageConfidence,
        totalIntents: nlpMetrics.totalIntents,
        lastTrainingTime: nlpMetrics.lastTrainingTime
      },
      recommendations: {
        enableCollaborativeFiltering: DEFAULT_ML_CONFIG.models.collaborativeFiltering.enabled,
        enableContentBased: DEFAULT_ML_CONFIG.models.contentBased.enabled,
        enableContextualBandits: DEFAULT_ML_CONFIG.models.contextualBandits.enabled,
        enableNeuralCF: DEFAULT_ML_CONFIG.models.neuralCollaborativeFiltering.enabled
      },
      performance: {
        trainingCompleted: true,
        ready: true
      }
    };

    logger.info('🎯 ML Training Report', report);

    // Save report to file for future reference
    // In a real implementation, this would be saved to a database or file system
  }
}

/**
 * Main training execution
 */
async function main(): Promise<void> {
  try {
    logger.info('🎯 ML Model Training Script Started');

    const trainer = new ModelTrainer();
    await trainer.trainAllModels();

    logger.info('🎉 All ML models trained successfully!');
    process.exit(0);

  } catch (error) {
    logger.error('💥 Training script failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

// Run training if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error in training script:', error);
    process.exit(1);
  });
}

export { ModelTrainer, TrainingDataGenerator, DEFAULT_ML_CONFIG, DEFAULT_NLP_CONFIG };
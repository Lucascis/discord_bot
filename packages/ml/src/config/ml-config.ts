/**
 * ML Configuration Management
 * Centralized configuration for machine learning components
 */

import { z } from 'zod';
import { logger } from '@discord-bot/logger';

/**
 * ML Configuration Schema
 */
export const MLConfigSchema = z.object({
  models: z.object({
    collaborativeFiltering: z.object({
      enabled: z.boolean().default(true),
      embeddingDim: z.number().min(8).max(512).default(50),
      learningRate: z.number().min(0.0001).max(0.1).default(0.001),
      regularization: z.number().min(0).max(1).default(0.01),
      maxUsers: z.number().min(1000).max(1000000).default(10000),
      maxTracks: z.number().min(1000).max(1000000).default(100000)
    }),
    contentBased: z.object({
      enabled: z.boolean().default(true),
      featureWeights: z.record(z.string(), z.number().min(0).max(2)).default({
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
      }),
      similarityThreshold: z.number().min(0).max(1).default(0.7)
    }),
    contextualBandits: z.object({
      enabled: z.boolean().default(true),
      explorationRate: z.number().min(0).max(1).default(0.1),
      updateFrequency: z.number().min(1).default(1000),
      rewardDecay: z.number().min(0).max(1).default(0.95)
    }),
    neuralCollaborativeFiltering: z.object({
      enabled: z.boolean().default(true),
      hiddenLayers: z.array(z.number().min(8).max(1024)).default([128, 64, 32]),
      dropout: z.number().min(0).max(0.9).default(0.3),
      activation: z.enum(['relu', 'tanh', 'sigmoid']).default('relu')
    })
  }),
  training: z.object({
    batchSize: z.number().min(1).max(1024).default(32),
    epochs: z.number().min(1).max(1000).default(50),
    validationSplit: z.number().min(0).max(0.5).default(0.2),
    earlyStoppingPatience: z.number().min(1).max(50).default(5),
    learningRateSchedule: z.enum(['constant', 'exponential', 'polynomial']).default('exponential'),
    saveModelCheckpoints: z.boolean().default(true),
    checkpointFrequency: z.number().min(1).default(10)
  }),
  inference: z.object({
    cacheSize: z.number().min(100).max(10000).default(1000),
    cacheTtlMs: z.number().min(60000).max(3600000).default(300000), // 1 min to 1 hour
    maxInferenceTime: z.number().min(100).max(10000).default(1000), // 0.1 to 10 seconds
    batchInference: z.boolean().default(true),
    maxBatchSize: z.number().min(1).max(100).default(10)
  }),
  data: z.object({
    maxUserHistory: z.number().min(100).max(10000).default(1000),
    featureNormalization: z.boolean().default(true),
    outlierDetection: z.boolean().default(true),
    dataAugmentation: z.boolean().default(false)
  }),
  evaluation: z.object({
    enabled: z.boolean().default(true),
    testSetSize: z.number().min(0.1).max(0.5).default(0.2),
    metricsToTrack: z.array(z.enum(['accuracy', 'precision', 'recall', 'f1', 'auc', 'ndcg'])).default(['accuracy', 'precision', 'recall']),
    evaluationFrequency: z.number().min(1).default(24) // hours
  })
});

/**
 * NLP Configuration Schema
 */
export const NLPConfigSchema = z.object({
  languages: z.array(z.string()).min(1).default(['en']),
  defaultLanguage: z.string().default('en'),
  confidenceThreshold: z.number().min(0).max(1).default(0.5),
  sentimentAnalysis: z.boolean().default(true),
  namedEntityRecognition: z.boolean().default(true),
  entityPatterns: z.record(z.string(), z.array(z.instanceof(RegExp))).default({}),
  training: z.object({
    retrainInterval: z.number().min(3600000).default(24 * 60 * 60 * 1000), // minimum 1 hour
    minExamplesForRetrain: z.number().min(10).default(100),
    usePretrainedModels: z.boolean().default(true),
    augmentTrainingData: z.boolean().default(true),
    crossValidation: z.boolean().default(true),
    folds: z.number().min(2).max(10).default(5)
  }),
  performance: z.object({
    cacheSize: z.number().min(100).max(10000).default(500),
    cacheTtlMs: z.number().min(60000).max(3600000).default(300000), // 1 min to 1 hour
    maxProcessingTime: z.number().min(100).max(5000).default(500), // 0.1 to 5 seconds
    parallelProcessing: z.boolean().default(true),
    maxConcurrentRequests: z.number().min(1).max(100).default(10)
  }),
  features: z.object({
    enableSpellCorrection: z.boolean().default(true),
    enableStemming: z.boolean().default(true),
    enableLemmatization: z.boolean().default(false),
    enableStopwordRemoval: z.boolean().default(true),
    enableNGrams: z.boolean().default(true),
    nGramRange: z.tuple([z.number().min(1), z.number().max(5)]).default([1, 3])
  }),
  contextual: z.object({
    enableContextAwareness: z.boolean().default(true),
    contextWindowSize: z.number().min(1).max(10).default(3),
    userPersonalization: z.boolean().default(true),
    adaptiveThresholds: z.boolean().default(true)
  })
});

export type MLConfig = z.infer<typeof MLConfigSchema>;
export type NLPConfig = z.infer<typeof NLPConfigSchema>;

/**
 * Environment-based ML Configuration
 */
export const MLEnvironmentConfigSchema = z.object({
  // TensorFlow.js configuration
  TENSORFLOW_BACKEND: z.enum(['cpu', 'webgl', 'node']).default('node'),
  TENSORFLOW_THREADS: z.string().transform(Number).pipe(z.number().min(1).max(32)).optional(),

  // Model storage
  ML_MODELS_PATH: z.string().default('./models'),
  ML_CHECKPOINTS_PATH: z.string().default('./checkpoints'),

  // Training settings
  ML_TRAINING_ENABLED: z.string().transform(v => v === 'true').default('true'),
  ML_AUTO_RETRAIN: z.string().transform(v => v === 'true').default('false'),
  ML_TRAINING_SCHEDULE: z.string().default('0 2 * * *'), // Daily at 2 AM

  // Performance settings
  ML_MAX_MEMORY_GB: z.string().transform(Number).pipe(z.number().min(0.5).max(32)).default('2'),
  ML_INFERENCE_TIMEOUT: z.string().transform(Number).pipe(z.number().min(100).max(10000)).default('1000'),

  // Feature flags
  ML_COLLABORATIVE_FILTERING: z.string().transform(v => v === 'true').default('true'),
  ML_CONTENT_BASED: z.string().transform(v => v === 'true').default('true'),
  ML_CONTEXTUAL_BANDITS: z.string().transform(v => v === 'true').default('true'),
  ML_NEURAL_CF: z.string().transform(v => v === 'true').default('true'),

  // NLP settings
  NLP_ENABLED: z.string().transform(v => v === 'true').default('true'),
  NLP_SENTIMENT_ANALYSIS: z.string().transform(v => v === 'true').default('true'),
  NLP_ENTITY_RECOGNITION: z.string().transform(v => v === 'true').default('true'),

  // Monitoring
  ML_METRICS_ENABLED: z.string().transform(v => v === 'true').default('true'),
  ML_LOGGING_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type MLEnvironmentConfig = z.infer<typeof MLEnvironmentConfigSchema>;

/**
 * Configuration Manager
 */
export class MLConfigManager {
  private static instance: MLConfigManager;
  private mlConfig: MLConfig;
  private nlpConfig: NLPConfig;
  private envConfig: MLEnvironmentConfig;

  private constructor() {
    this.envConfig = this.loadEnvironmentConfig();
    this.mlConfig = this.loadMLConfig();
    this.nlpConfig = this.loadNLPConfig();
  }

  static getInstance(): MLConfigManager {
    if (!MLConfigManager.instance) {
      MLConfigManager.instance = new MLConfigManager();
    }
    return MLConfigManager.instance;
  }

  getMLConfig(): MLConfig {
    return this.mlConfig;
  }

  getNLPConfig(): NLPConfig {
    return this.nlpConfig;
  }

  getEnvironmentConfig(): MLEnvironmentConfig {
    return this.envConfig;
  }

  /**
   * Update ML configuration at runtime
   */
  updateMLConfig(updates: Partial<MLConfig>): void {
    this.mlConfig = MLConfigSchema.parse({
      ...this.mlConfig,
      ...updates
    });

    logger.info('ML configuration updated', {
      updates: Object.keys(updates)
    });
  }

  /**
   * Update NLP configuration at runtime
   */
  updateNLPConfig(updates: Partial<NLPConfig>): void {
    this.nlpConfig = NLPConfigSchema.parse({
      ...this.nlpConfig,
      ...updates
    });

    logger.info('NLP configuration updated', {
      updates: Object.keys(updates)
    });
  }

  /**
   * Validate current configuration
   */
  validateConfiguration(): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      MLConfigSchema.parse(this.mlConfig);
      NLPConfigSchema.parse(this.nlpConfig);
      MLEnvironmentConfigSchema.parse(this.envConfig);

      // Additional validation logic
      if (this.mlConfig.training.batchSize > this.mlConfig.data.maxUserHistory) {
        warnings.push('Training batch size is larger than max user history');
      }

      if (this.mlConfig.inference.maxInferenceTime < 100) {
        warnings.push('Very low max inference time may cause timeouts');
      }

      if (this.nlpConfig.performance.maxProcessingTime < 100) {
        warnings.push('Very low NLP processing time may cause timeouts');
      }

      return {
        isValid: true,
        errors,
        warnings
      };

    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push(...error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
      } else {
        errors.push('Unknown configuration validation error');
      }

      return {
        isValid: false,
        errors,
        warnings
      };
    }
  }

  /**
   * Get configuration optimized for the current environment
   */
  getOptimizedConfig(): {
    ml: MLConfig;
    nlp: NLPConfig;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let optimizedML = { ...this.mlConfig };
    let optimizedNLP = { ...this.nlpConfig };

    // Performance optimizations based on environment
    const maxMemoryGB = this.envConfig.ML_MAX_MEMORY_GB;

    if (maxMemoryGB < 2) {
      // Low memory environment
      optimizedML.models.neuralCollaborativeFiltering.hiddenLayers = [64, 32];
      optimizedML.training.batchSize = Math.min(16, optimizedML.training.batchSize);
      optimizedML.inference.cacheSize = Math.min(500, optimizedML.inference.cacheSize);
      optimizedNLP.performance.cacheSize = Math.min(250, optimizedNLP.performance.cacheSize);

      recommendations.push('Reduced model complexity for low memory environment');
    }

    if (maxMemoryGB > 8) {
      // High memory environment
      optimizedML.models.neuralCollaborativeFiltering.hiddenLayers = [256, 128, 64];
      optimizedML.training.batchSize = Math.max(64, optimizedML.training.batchSize);

      recommendations.push('Increased model complexity for high memory environment');
    }

    // CPU optimization
    if (this.envConfig.TENSORFLOW_BACKEND === 'cpu') {
      optimizedML.training.epochs = Math.min(20, optimizedML.training.epochs);
      optimizedML.inference.batchInference = true;

      recommendations.push('Optimized for CPU-only inference');
    }

    return {
      ml: optimizedML,
      nlp: optimizedNLP,
      recommendations
    };
  }

  private loadEnvironmentConfig(): MLEnvironmentConfig {
    return MLEnvironmentConfigSchema.parse(process.env);
  }

  private loadMLConfig(): MLConfig {
    // Load from environment or use defaults
    const envConfig = this.envConfig;

    return MLConfigSchema.parse({
      models: {
        collaborativeFiltering: {
          enabled: envConfig.ML_COLLABORATIVE_FILTERING
        },
        contentBased: {
          enabled: envConfig.ML_CONTENT_BASED
        },
        contextualBandits: {
          enabled: envConfig.ML_CONTEXTUAL_BANDITS
        },
        neuralCollaborativeFiltering: {
          enabled: envConfig.ML_NEURAL_CF
        }
      },
      training: {
        // Use environment-based overrides or defaults
      },
      inference: {
        maxInferenceTime: envConfig.ML_INFERENCE_TIMEOUT
      }
    });
  }

  private loadNLPConfig(): NLPConfig {
    const envConfig = this.envConfig;

    return NLPConfigSchema.parse({
      sentimentAnalysis: envConfig.NLP_SENTIMENT_ANALYSIS,
      namedEntityRecognition: envConfig.NLP_ENTITY_RECOGNITION,
      performance: {
        // Use environment-based overrides or defaults
      }
    });
  }
}

/**
 * Export singleton instance
 */
export const mlConfigManager = MLConfigManager.getInstance();
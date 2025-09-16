/**
 * ML Package Entry Point
 * Machine Learning and Natural Language Processing for Discord Music Bot
 */

// Music Recommendation System
export {
  MusicRecommender,
  type TrackFeatures,
  type UserBehavior,
  type RecommendationRequest,
  type RecommendationResult,
  type MLConfig
} from './recommendation/music-recommender.js';

// Natural Language Processing
export {
  IntentRecognition,
  MUSIC_INTENTS,
  type RecognizedIntent,
  type IntentEntity,
  type TrainingExample,
  type NLPConfig
} from './nlp/intent-recognition.js';

// Configuration Management
export {
  MLConfigManager,
  mlConfigManager,
  MLConfigSchema,
  NLPConfigSchema,
  MLEnvironmentConfigSchema,
  type MLEnvironmentConfig
} from './config/ml-config.js';

// Training and Utilities
export {
  ModelTrainer,
  TrainingDataGenerator,
  DEFAULT_ML_CONFIG,
  DEFAULT_NLP_CONFIG
} from './scripts/train-models.js';

/**
 * ML System Factory
 */
export class MLSystemFactory {
  /**
   * Create a complete ML system with both recommendation and NLP
   */
  static async createMLSystem(config?: {
    ml?: Partial<MLConfig>;
    nlp?: Partial<NLPConfig>;
  }) {
    const configManager = MLConfigManager.getInstance();

    if (config?.ml) {
      configManager.updateMLConfig(config.ml);
    }

    if (config?.nlp) {
      configManager.updateNLPConfig(config.nlp);
    }

    const mlConfig = configManager.getMLConfig();
    const nlpConfig = configManager.getNLPConfig();

    const musicRecommender = new MusicRecommender(mlConfig);
    const intentRecognition = new IntentRecognition(nlpConfig);

    await musicRecommender.initialize();
    await intentRecognition.initialize();

    return {
      musicRecommender,
      intentRecognition,
      configManager
    };
  }

  /**
   * Create music recommendation system only
   */
  static async createMusicRecommender(config?: Partial<MLConfig>) {
    const configManager = MLConfigManager.getInstance();

    if (config) {
      configManager.updateMLConfig(config);
    }

    const mlConfig = configManager.getMLConfig();
    const musicRecommender = new MusicRecommender(mlConfig);

    await musicRecommender.initialize();

    return musicRecommender;
  }

  /**
   * Create NLP intent recognition system only
   */
  static async createIntentRecognition(config?: Partial<NLPConfig>) {
    const configManager = MLConfigManager.getInstance();

    if (config) {
      configManager.updateNLPConfig(config);
    }

    const nlpConfig = configManager.getNLPConfig();
    const intentRecognition = new IntentRecognition(nlpConfig);

    await intentRecognition.initialize();

    return intentRecognition;
  }
}
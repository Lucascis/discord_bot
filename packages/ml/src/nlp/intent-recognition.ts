import { NlpManager } from 'node-nlp';
import * as natural from 'natural';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Recognized Intent
 */
export interface RecognizedIntent {
  intent: string;
  confidence: number;
  entities: IntentEntity[];
  sentiment: {
    score: number;    // -1 to 1
    comparative: number;
    calculation: any[];
    tokens: string[];
    words: string[];
    positive: string[];
    negative: string[];
  };
  language: string;
  utterance: string;
}

/**
 * Intent Entity
 */
export interface IntentEntity {
  entity: string;
  option: string;
  start: number;
  end: number;
  len: number;
  accuracy: number;
  sourceText: string;
  utteranceText: string;
  alias?: string;
}

/**
 * Training Example
 */
export interface TrainingExample {
  intent: string;
  utterances: string[];
  entities?: {
    entity: string;
    options: string[];
  }[];
}

/**
 * NLP Configuration
 */
export interface NLPConfig {
  /** Supported languages */
  languages: string[];

  /** Default language */
  defaultLanguage: string;

  /** Confidence threshold for intent recognition */
  confidenceThreshold: number;

  /** Enable sentiment analysis */
  sentimentAnalysis: boolean;

  /** Enable named entity recognition */
  namedEntityRecognition: boolean;

  /** Custom entity patterns */
  entityPatterns: {
    [entity: string]: RegExp[];
  };

  /** Training configuration */
  training: {
    /** Auto-retrain interval (ms) */
    retrainInterval: number;

    /** Minimum examples to trigger retrain */
    minExamplesForRetrain: number;

    /** Use pre-trained models */
    usePretrainedModels: boolean;
  };

  /** Performance settings */
  performance: {
    /** Cache size for processed utterances */
    cacheSize: number;

    /** Cache TTL in milliseconds */
    cacheTtlMs: number;

    /** Maximum processing time (ms) */
    maxProcessingTime: number;
  };
}

/**
 * Music-specific Intents
 */
export const MUSIC_INTENTS = {
  PLAY_MUSIC: 'play_music',
  PAUSE_MUSIC: 'pause_music',
  RESUME_MUSIC: 'resume_music',
  STOP_MUSIC: 'stop_music',
  SKIP_TRACK: 'skip_track',
  PREVIOUS_TRACK: 'previous_track',
  VOLUME_UP: 'volume_up',
  VOLUME_DOWN: 'volume_down',
  SET_VOLUME: 'set_volume',
  SHOW_QUEUE: 'show_queue',
  CLEAR_QUEUE: 'clear_queue',
  SHUFFLE_QUEUE: 'shuffle_queue',
  LOOP_TRACK: 'loop_track',
  LOOP_QUEUE: 'loop_queue',
  SEARCH_MUSIC: 'search_music',
  ADD_TO_PLAYLIST: 'add_to_playlist',
  SHOW_LYRICS: 'show_lyrics',
  MUSIC_INFO: 'music_info',
  MUSIC_RECOMMENDATION: 'music_recommendation',
  SET_MOOD: 'set_mood',
  DISCONNECT: 'disconnect',
  HELP: 'help',
  GREETING: 'greeting',
  THANKS: 'thanks',
  GOODBYE: 'goodbye'
} as const;

/**
 * Intent Recognition NLP System
 * Advanced natural language processing for Discord music commands
 */
export class IntentRecognition {
  private readonly nlpManager: NlpManager;
  private readonly config: NLPConfig;
  private readonly metrics?: MetricsCollector;

  // Processing cache
  private readonly processCache = new Map<string, {
    result: RecognizedIntent;
    timestamp: Date;
  }>();

  // Training data
  private readonly trainingExamples = new Map<string, TrainingExample>();
  private lastTrainingTime = 0;
  private totalProcessed = 0;
  private averageProcessingTime = 0;
  private totalConfidence = 0;

  constructor(config: NLPConfig, metrics?: MetricsCollector) {
    this.config = config;
    this.metrics = metrics;

    // Initialize NLP Manager
    this.nlpManager = new NlpManager({
      languages: config.languages,
      forceNER: config.namedEntityRecognition,
      useLRC: false, // Disable Language Resource Classifier for better performance
      useNoneFeature: true,
      nlu: { log: false }
    });

    // Configure sentiment analyzer
    if (config.sentimentAnalysis) {
      this.nlpManager.addLanguage('en');
    }

    logger.info('Intent Recognition system initialized', {
      languages: config.languages,
      confidenceThreshold: config.confidenceThreshold,
      sentimentAnalysis: config.sentimentAnalysis,
      namedEntityRecognition: config.namedEntityRecognition
    });
  }

  /**
   * Initialize the NLP system with training data
   */
  async initialize(): Promise<void> {
    try {
      // Add default training data
      await this.addDefaultTrainingData();

      // Add custom entities
      this.addCustomEntities();

      // Train the model
      await this.train();

      logger.info('Intent Recognition system initialized and trained');

    } catch (error) {
      logger.error('Failed to initialize Intent Recognition system', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Process natural language input and recognize intent
   */
  async processUtterance(
    utterance: string,
    userId?: string,
    context?: {
      isPlaying?: boolean;
      currentTrack?: string;
      queueLength?: number;
      volume?: number;
    }
  ): Promise<RecognizedIntent> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(utterance, context);

    try {
      // Check cache first
      const cached = this.processCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp.getTime() < this.config.performance.cacheTtlMs) {
        this.recordMetrics('cache_hit', Date.now() - startTime);
        return cached.result;
      }

      // Preprocess utterance
      const processedUtterance = this.preprocessUtterance(utterance);

      // Process with NLP manager
      const nlpResult = await this.nlpManager.process(
        this.config.defaultLanguage,
        processedUtterance
      );

      // Post-process results
      const intent = this.postProcessIntent(nlpResult, context);

      // Apply context-aware adjustments
      const contextualIntent = this.applyContextualAdjustments(intent, context);

      // Cache result
      this.processCache.set(cacheKey, {
        result: contextualIntent,
        timestamp: new Date()
      });

      // Clean cache if too large
      if (this.processCache.size > this.config.performance.cacheSize) {
        this.cleanupCache();
      }

      // Update metrics
      this.totalProcessed++;
      this.averageProcessingTime = (this.averageProcessingTime + (Date.now() - startTime)) / 2;
      this.totalConfidence += contextualIntent.confidence;
      this.recordMetrics('intent_processed', Date.now() - startTime);

      logger.debug('Intent processed', {
        utterance: utterance.substring(0, 100),
        intent: contextualIntent.intent,
        confidence: contextualIntent.confidence,
        processingTime: Date.now() - startTime,
        userId
      });

      return contextualIntent;

    } catch (error) {
      this.recordMetrics('processing_error', Date.now() - startTime);

      logger.error('Failed to process utterance', {
        utterance: utterance.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
        userId
      });

      // Return fallback intent
      return {
        intent: 'unknown',
        confidence: 0,
        entities: [],
        sentiment: {
          score: 0,
          comparative: 0,
          calculation: [],
          tokens: [],
          words: [],
          positive: [],
          negative: []
        },
        language: this.config.defaultLanguage,
        utterance
      };
    }
  }

  /**
   * Add training data for intent recognition
   */
  async addTrainingData(examples: TrainingExample[]): Promise<void> {
    for (const example of examples) {
      this.trainingExamples.set(example.intent, example);

      // Add utterances to NLP manager
      for (const utterance of example.utterances) {
        this.nlpManager.addDocument(
          this.config.defaultLanguage,
          utterance,
          example.intent
        );
      }

      // Add entities
      if (example.entities) {
        for (const entity of example.entities) {
          for (const option of entity.options) {
            this.nlpManager.addNamedEntityText(
              entity.entity,
              option,
              [this.config.defaultLanguage],
              [option]
            );
          }
        }
      }
    }

    logger.info('Training data added', {
      intents: examples.length,
      totalIntents: this.trainingExamples.size
    });

    // Check if we should retrain
    await this.checkAndRetrain();
  }

  /**
   * Train the NLP model
   */
  async train(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.nlpManager.train();
      this.lastTrainingTime = Date.now();

      const trainingTime = Date.now() - startTime;

      logger.info('NLP model training completed', {
        trainingTime,
        totalIntents: this.trainingExamples.size
      });

      if (this.metrics) {
        this.metrics.recordCustomMetric(
          'nlp_training_duration_ms',
          trainingTime,
          {},
          'histogram'
        );
      }

    } catch (error) {
      logger.error('NLP model training failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get NLP system metrics
   */
  getMetrics(): {
    totalProcessed: number;
    averageProcessingTime: number;
    averageConfidence: number;
    cacheHitRate: number;
    totalIntents: number;
    lastTrainingTime: Date;
  } {
    return {
      totalProcessed: this.totalProcessed,
      averageProcessingTime: this.averageProcessingTime,
      averageConfidence: this.totalProcessed > 0 ? this.totalConfidence / this.totalProcessed : 0,
      cacheHitRate: 0, // TODO: Implement cache hit rate tracking
      totalIntents: this.trainingExamples.size,
      lastTrainingTime: new Date(this.lastTrainingTime)
    };
  }

  /**
   * Suggest intent based on partial input
   */
  async suggestIntents(partialInput: string, maxSuggestions: number = 5): Promise<{
    intent: string;
    confidence: number;
    completion: string;
  }[]> {
    const suggestions: {
      intent: string;
      confidence: number;
      completion: string;
    }[] = [];

    // Process with current input
    const result = await this.processUtterance(partialInput);

    if (result.confidence > 0.3) {
      suggestions.push({
        intent: result.intent,
        confidence: result.confidence,
        completion: partialInput
      });
    }

    // Generate variations for better suggestions
    const variations = this.generateInputVariations(partialInput);

    for (const variation of variations) {
      if (suggestions.length >= maxSuggestions) break;

      const varResult = await this.processUtterance(variation);
      if (varResult.confidence > 0.4 && !suggestions.some(s => s.intent === varResult.intent)) {
        suggestions.push({
          intent: varResult.intent,
          confidence: varResult.confidence,
          completion: variation
        });
      }
    }

    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSuggestions);
  }

  // Private methods

  private async addDefaultTrainingData(): Promise<void> {
    const defaultTraining: TrainingExample[] = [
      {
        intent: MUSIC_INTENTS.PLAY_MUSIC,
        utterances: [
          'play music',
          'start playing',
          'put on some music',
          'play something',
          'play %song%',
          'can you play %song%',
          'play the song %song%',
          'I want to hear %song%',
          'put on %song%',
          'start %song%'
        ],
        entities: [
          {
            entity: 'song',
            options: ['song name', 'artist name', 'album name']
          }
        ]
      },
      {
        intent: MUSIC_INTENTS.PAUSE_MUSIC,
        utterances: [
          'pause',
          'pause music',
          'stop playing',
          'pause the music',
          'hold on',
          'wait',
          'pause this',
          'stop for a moment'
        ]
      },
      {
        intent: MUSIC_INTENTS.VOLUME_UP,
        utterances: [
          'volume up',
          'turn it up',
          'louder',
          'increase volume',
          'make it louder',
          'turn up the volume',
          'more volume'
        ]
      },
      {
        intent: MUSIC_INTENTS.VOLUME_DOWN,
        utterances: [
          'volume down',
          'turn it down',
          'quieter',
          'decrease volume',
          'make it quieter',
          'turn down the volume',
          'less volume',
          'lower volume'
        ]
      },
      {
        intent: MUSIC_INTENTS.SET_VOLUME,
        utterances: [
          'set volume to %number%',
          'volume %number%',
          'change volume to %number%',
          'make volume %number%',
          'set it to %number%'
        ],
        entities: [
          {
            entity: 'number',
            options: ['50', '75', '100', 'fifty', 'seventy five', 'one hundred']
          }
        ]
      },
      {
        intent: MUSIC_INTENTS.SKIP_TRACK,
        utterances: [
          'skip',
          'next',
          'skip song',
          'next song',
          'skip this',
          'next track',
          'skip track',
          'go to next',
          'change song'
        ]
      },
      {
        intent: MUSIC_INTENTS.SHOW_QUEUE,
        utterances: [
          'show queue',
          'what\'s in queue',
          'queue',
          'what\'s next',
          'show playlist',
          'what\'s coming up',
          'list queue'
        ]
      },
      {
        intent: MUSIC_INTENTS.MUSIC_RECOMMENDATION,
        utterances: [
          'recommend something',
          'suggest music',
          'what should I play',
          'surprise me',
          'play something similar',
          'find similar songs',
          'recommend based on %mood%',
          'I\'m feeling %mood%'
        ],
        entities: [
          {
            entity: 'mood',
            options: ['happy', 'sad', 'energetic', 'calm', 'party', 'chill', 'workout']
          }
        ]
      },
      {
        intent: MUSIC_INTENTS.GREETING,
        utterances: [
          'hello',
          'hi',
          'hey',
          'hi there',
          'hello bot',
          'hey bot',
          'good morning',
          'good afternoon',
          'good evening'
        ]
      },
      {
        intent: MUSIC_INTENTS.HELP,
        utterances: [
          'help',
          'what can you do',
          'commands',
          'how to use',
          'what are the commands',
          'help me',
          'show commands',
          'list commands'
        ]
      }
    ];

    await this.addTrainingData(defaultTraining);
  }

  private addCustomEntities(): void {
    // Add custom entity patterns
    for (const [entity, patterns] of Object.entries(this.config.entityPatterns)) {
      for (const pattern of patterns) {
        this.nlpManager.addRegexEntity(entity, this.config.defaultLanguage, pattern);
      }
    }

    // Add built-in entities
    this.nlpManager.addNamedEntityText('number', '0', ['en'], ['zero', '0']);
    this.nlpManager.addNamedEntityText('number', '1', ['en'], ['one', '1']);
    // ... add more numbers

    logger.debug('Custom entities added to NLP manager');
  }

  private preprocessUtterance(utterance: string): string {
    return utterance
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  private postProcessIntent(nlpResult: any, context?: any): RecognizedIntent {
    // Extract sentiment if available
    let sentiment = {
      score: 0,
      comparative: 0,
      calculation: [],
      tokens: [],
      words: [],
      positive: [],
      negative: []
    };

    if (this.config.sentimentAnalysis && nlpResult.sentiment) {
      sentiment = nlpResult.sentiment;
    }

    return {
      intent: nlpResult.intent || 'unknown',
      confidence: nlpResult.score || 0,
      entities: nlpResult.entities || [],
      sentiment,
      language: nlpResult.locale || this.config.defaultLanguage,
      utterance: nlpResult.utterance || ''
    };
  }

  private applyContextualAdjustments(
    intent: RecognizedIntent,
    context?: {
      isPlaying?: boolean;
      currentTrack?: string;
      queueLength?: number;
      volume?: number;
    }
  ): RecognizedIntent {
    if (!context) {
      return intent;
    }

    let adjustedConfidence = intent.confidence;

    // Context-aware confidence adjustments
    if (intent.intent === MUSIC_INTENTS.PAUSE_MUSIC && context.isPlaying) {
      adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.2);
    }

    if (intent.intent === MUSIC_INTENTS.RESUME_MUSIC && !context.isPlaying) {
      adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.2);
    }

    if (intent.intent === MUSIC_INTENTS.SKIP_TRACK && context.queueLength === 0) {
      adjustedConfidence = Math.max(0.0, adjustedConfidence - 0.3);
    }

    return {
      ...intent,
      confidence: adjustedConfidence
    };
  }

  private generateInputVariations(input: string): string[] {
    const variations: string[] = [];

    // Add common music command prefixes
    const prefixes = ['play', 'search', 'find', 'put on'];
    for (const prefix of prefixes) {
      if (!input.includes(prefix)) {
        variations.push(`${prefix} ${input}`);
      }
    }

    // Add question forms
    variations.push(`can you ${input}`);
    variations.push(`could you ${input}`);
    variations.push(`please ${input}`);

    return variations;
  }

  private async checkAndRetrain(): Promise<void> {
    const now = Date.now();
    const timeSinceLastTraining = now - this.lastTrainingTime;

    if (timeSinceLastTraining > this.config.training.retrainInterval) {
      logger.info('Triggering automatic model retraining');
      await this.train();
    }
  }

  private generateCacheKey(utterance: string, context?: any): string {
    const contextStr = context ? JSON.stringify(context) : '';
    return `${utterance.toLowerCase()}-${contextStr}`;
  }

  private cleanupCache(): void {
    // Remove oldest cache entries
    const entries = Array.from(this.processCache.entries());
    entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3));
    toRemove.forEach(([key]) => this.processCache.delete(key));

    logger.debug('NLP cache cleanup completed', {
      removed: toRemove.length,
      remaining: this.processCache.size
    });
  }

  private recordMetrics(type: 'cache_hit' | 'intent_processed' | 'processing_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'nlp_processing_requests_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'nlp_processing_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}
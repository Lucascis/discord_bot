/**
 * Audio Quality Value Object
 * Represents different audio quality tiers available in the system
 */

export type AudioQualityLevel = 'standard' | 'high' | 'lossless' | 'spatial';

export interface AudioQualityConfig {
  readonly bitrate: number;      // kbps
  readonly sampleRate: number;   // Hz
  readonly channels: number;     // 1=mono, 2=stereo, >2=surround
  readonly format: 'mp3' | 'aac' | 'opus' | 'flac';
  readonly spatialEnabled: boolean;
  readonly effectsEnabled: boolean;
}

export class AudioQuality {
  private static readonly QUALITY_CONFIGS: Record<AudioQualityLevel, AudioQualityConfig> = {
    standard: {
      bitrate: 128,
      sampleRate: 44100,
      channels: 2,
      format: 'opus',
      spatialEnabled: false,
      effectsEnabled: false
    },
    high: {
      bitrate: 320,
      sampleRate: 48000,
      channels: 2,
      format: 'opus',
      spatialEnabled: false,
      effectsEnabled: true
    },
    lossless: {
      bitrate: 1411, // CD quality
      sampleRate: 44100,
      channels: 2,
      format: 'flac',
      spatialEnabled: false,
      effectsEnabled: true
    },
    spatial: {
      bitrate: 1411,
      sampleRate: 48000,
      channels: 8, // 7.1 surround
      format: 'flac',
      spatialEnabled: true,
      effectsEnabled: true
    }
  };

  constructor(private readonly _level: AudioQualityLevel) {
    this.validateLevel(_level);
  }

  get level(): AudioQualityLevel {
    return this._level;
  }

  get config(): AudioQualityConfig {
    return AudioQuality.QUALITY_CONFIGS[this._level];
  }

  get bitrate(): number {
    return this.config.bitrate;
  }

  get sampleRate(): number {
    return this.config.sampleRate;
  }

  get channels(): number {
    return this.config.channels;
  }

  get format(): string {
    return this.config.format;
  }

  get isSpatialEnabled(): boolean {
    return this.config.spatialEnabled;
  }

  get areEffectsEnabled(): boolean {
    return this.config.effectsEnabled;
  }

  /**
   * Check if this quality is better than another
   */
  isBetterThan(other: AudioQuality): boolean {
    const qualityOrder: AudioQualityLevel[] = ['standard', 'high', 'lossless', 'spatial'];
    const thisIndex = qualityOrder.indexOf(this._level);
    const otherIndex = qualityOrder.indexOf(other._level);
    return thisIndex > otherIndex;
  }

  /**
   * Check if this quality is compatible with another (can be downgraded to)
   */
  isCompatibleWith(other: AudioQuality): boolean {
    // Spatial audio can downgrade to any format
    if (this._level === 'spatial') return true;

    // Lossless can downgrade to high or standard
    if (this._level === 'lossless') return other._level !== 'spatial';

    // High can downgrade to standard
    if (this._level === 'high') return other._level === 'standard' || other._level === 'high';

    // Standard is baseline
    return other._level === 'standard';
  }

  /**
   * Get the best quality that doesn't exceed given bandwidth limits
   */
  static forBandwidth(maxBitrateKbps: number): AudioQuality {
    if (maxBitrateKbps >= 1411) return new AudioQuality('spatial');
    if (maxBitrateKbps >= 320) return new AudioQuality('lossless');
    if (maxBitrateKbps >= 256) return new AudioQuality('high');
    return new AudioQuality('standard');
  }

  /**
   * Create from string value
   */
  static from(level: string): AudioQuality {
    if (!this.isValidLevel(level)) {
      throw new Error(`Invalid audio quality level: ${level}`);
    }
    return new AudioQuality(level as AudioQualityLevel);
  }

  /**
   * Check if level is valid
   */
  static isValidLevel(level: string): level is AudioQualityLevel {
    return ['standard', 'high', 'lossless', 'spatial'].includes(level);
  }

  /**
   * Get all available quality levels
   */
  static getAllLevels(): AudioQualityLevel[] {
    return ['standard', 'high', 'lossless', 'spatial'];
  }

  private validateLevel(level: AudioQualityLevel): void {
    if (!AudioQuality.isValidLevel(level)) {
      throw new Error(`Invalid audio quality level: ${level}`);
    }
  }

  equals(other: AudioQuality): boolean {
    return this._level === other._level;
  }

  toString(): string {
    return `AudioQuality(${this._level})`;
  }

  toJSON(): { level: AudioQualityLevel; config: AudioQualityConfig } {
    return {
      level: this._level,
      config: this.config
    };
  }
}
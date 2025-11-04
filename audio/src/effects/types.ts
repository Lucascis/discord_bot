/**
 * Audio Effects Engine - Premium Types
 * Advanced audio processing for Discord Music Bot
 */

export interface AudioEffect {
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
  apply(audioData: Float32Array): Float32Array;
}

export interface CrossfadeSettings {
  enabled: boolean;
  duration: number; // in milliseconds (2000-8000)
  curve: 'linear' | 'exponential' | 'logarithmic';
  overlap: boolean;
}

export interface EqualizerBand {
  frequency: number; // Hz
  gain: number; // dB (-12 to +12)
  q: number; // Quality factor (0.1 to 30)
}

export interface EqualizerSettings {
  enabled: boolean;
  bands: EqualizerBand[];
  presets: {
    flat: EqualizerBand[];
    rock: EqualizerBand[];
    pop: EqualizerBand[];
    jazz: EqualizerBand[];
    classical: EqualizerBand[];
    electronic: EqualizerBand[];
    bass_boost: EqualizerBand[];
    vocal_enhance: EqualizerBand[];
  };
}

export interface AudioEffectsSettings {
  // Core Effects
  crossfade: CrossfadeSettings;
  equalizer: EqualizerSettings;

  // Volume & Dynamics
  volume: number; // 0.0 to 2.0 (200%)
  bassBoost: number; // 0.0 to 1.0
  trebleBoost: number; // 0.0 to 1.0
  loudnessNormalization: boolean;

  // Creative Effects
  nightcore: {
    enabled: boolean;
    speed: number; // 1.0 to 1.5
    pitch: number; // -12 to +12 semitones
  };

  daycore: {
    enabled: boolean;
    speed: number; // 0.7 to 1.0
    pitch: number; // -12 to +12 semitones
  };

  eightD: {
    enabled: boolean;
    intensity: number; // 0.0 to 1.0
    speed: number; // rotation speed
  };

  reverb: {
    enabled: boolean;
    roomSize: number; // 0.0 to 1.0
    damping: number; // 0.0 to 1.0
    wetness: number; // 0.0 to 1.0
  };

  // Quality Enhancement
  stereoWidening: {
    enabled: boolean;
    width: number; // 0.0 to 2.0
  };

  compressor: {
    enabled: boolean;
    threshold: number; // dB
    ratio: number; // 1:1 to 20:1
    attack: number; // ms
    release: number; // ms
  };
}

export interface AudioProcessingChain {
  guildId: string;
  settings: AudioEffectsSettings;
  isProcessing: boolean;
  lastUpdated: Date;
}

export interface AudioAnalysisData {
  bpm: number;
  key: string;
  energy: number; // 0.0 to 1.0
  danceability: number; // 0.0 to 1.0
  valence: number; // 0.0 to 1.0 (mood)
  acousticness: number; // 0.0 to 1.0
  loudness: number; // dB
  tempo: number;
  timeSignature: number;
}

export interface SmartCrossfadeContext {
  currentTrack: {
    analysis: AudioAnalysisData;
    duration: number;
    position: number;
  };
  nextTrack: {
    analysis: AudioAnalysisData;
    duration: number;
  };
  suggestedCrossfadeDuration: number;
  suggestedCrossfadePoint: number;
}

export enum AudioQuality {
  STANDARD = 'standard', // 128kbps
  HIGH = 'high',        // 256kbps
  LOSSLESS = 'lossless', // 320kbps+
  ULTRA = 'ultra'       // Uncompressed
}

export interface QualitySettings {
  preferred: AudioQuality;
  fallback: AudioQuality[];
  adaptiveQuality: boolean; // Adjust based on connection
}

export interface AudioEffectsState {
  guildId: string;
  userId?: string; // For personal effects
  effects: AudioEffectsSettings;
  quality: QualitySettings;
  processing: {
    enabled: boolean;
    latency: number; // Current processing latency in ms
    cpuUsage: number; // 0.0 to 1.0
  };
}

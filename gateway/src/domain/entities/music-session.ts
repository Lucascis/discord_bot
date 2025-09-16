import { GuildId } from '../value-objects/guild-id.js';
import { UserId } from '../value-objects/user-id.js';

export type SessionState = 'idle' | 'playing' | 'paused' | 'stopped';
export type LoopMode = 'off' | 'track' | 'queue';

/**
 * Music Session Entity
 * Represents the current music playback session for a guild
 */
export class MusicSession {
  constructor(
    private readonly _guildId: GuildId,
    private _state: SessionState = 'idle',
    private _currentTrack: string | null = null,
    private _volume: number = 100,
    private _position: number = 0,
    private _loopMode: LoopMode = 'off',
    private _queueLength: number = 0,
    private _lastUpdated: Date = new Date(),
    private _voiceChannelId: string | null = null,
    private _textChannelId: string | null = null,
    private _isPaused: boolean = false
  ) {
    this.validateVolume(_volume);
  }

  get guildId(): GuildId {
    return this._guildId;
  }

  get state(): SessionState {
    return this._state;
  }

  get currentTrack(): string | null {
    return this._currentTrack;
  }

  get volume(): number {
    return this._volume;
  }

  get position(): number {
    return this._position;
  }

  get loopMode(): LoopMode {
    return this._loopMode;
  }

  get queueLength(): number {
    return this._queueLength;
  }

  get lastUpdated(): Date {
    return this._lastUpdated;
  }

  get voiceChannelId(): string | null {
    return this._voiceChannelId;
  }

  get textChannelId(): string | null {
    return this._textChannelId;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get isActive(): boolean {
    return this._state === 'playing' || this._state === 'paused';
  }

  get isIdle(): boolean {
    return this._state === 'idle';
  }

  startPlaying(trackTitle: string, voiceChannelId: string, textChannelId: string): void {
    this._state = 'playing';
    this._currentTrack = trackTitle;
    this._voiceChannelId = voiceChannelId;
    this._textChannelId = textChannelId;
    this._isPaused = false;
    this._position = 0;
    this._lastUpdated = new Date();
  }

  pause(): void {
    if (this._state === 'playing') {
      this._state = 'paused';
      this._isPaused = true;
      this._lastUpdated = new Date();
    }
  }

  resume(): void {
    if (this._state === 'paused') {
      this._state = 'playing';
      this._isPaused = false;
      this._lastUpdated = new Date();
    }
  }

  stop(): void {
    this._state = 'stopped';
    this._currentTrack = null;
    this._position = 0;
    this._isPaused = false;
    this._lastUpdated = new Date();
  }

  disconnect(): void {
    this._state = 'idle';
    this._currentTrack = null;
    this._voiceChannelId = null;
    this._textChannelId = null;
    this._position = 0;
    this._isPaused = false;
    this._queueLength = 0;
    this._lastUpdated = new Date();
  }

  setVolume(volume: number): void {
    this.validateVolume(volume);
    this._volume = volume;
    this._lastUpdated = new Date();
  }

  setPosition(position: number): void {
    if (position < 0) {
      throw new Error('Position cannot be negative');
    }
    this._position = position;
    this._lastUpdated = new Date();
  }

  setLoopMode(mode: LoopMode): void {
    this._loopMode = mode;
    this._lastUpdated = new Date();
  }

  updateQueueLength(length: number): void {
    if (length < 0) {
      throw new Error('Queue length cannot be negative');
    }
    this._queueLength = length;
    this._lastUpdated = new Date();
  }

  skipToNext(): void {
    if (this._queueLength > 0) {
      this._queueLength -= 1;
    }
    this._position = 0;
    this._lastUpdated = new Date();
  }

  addToQueue(): void {
    this._queueLength += 1;
    this._lastUpdated = new Date();
  }

  private validateVolume(volume: number): void {
    if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
      throw new Error('Volume must be an integer between 0 and 200');
    }
  }

  static create(guildId: GuildId): MusicSession {
    return new MusicSession(guildId);
  }

  static fromData(data: {
    guildId: string;
    state?: SessionState;
    currentTrack?: string | null;
    volume?: number;
    position?: number;
    loopMode?: LoopMode;
    queueLength?: number;
    lastUpdated?: Date;
    voiceChannelId?: string | null;
    textChannelId?: string | null;
    isPaused?: boolean;
  }): MusicSession {
    return new MusicSession(
      GuildId.from(data.guildId),
      data.state ?? 'idle',
      data.currentTrack ?? null,
      data.volume ?? 100,
      data.position ?? 0,
      data.loopMode ?? 'off',
      data.queueLength ?? 0,
      data.lastUpdated ?? new Date(),
      data.voiceChannelId ?? null,
      data.textChannelId ?? null,
      data.isPaused ?? false
    );
  }

  toData(): {
    guildId: string;
    state: SessionState;
    currentTrack: string | null;
    volume: number;
    position: number;
    loopMode: LoopMode;
    queueLength: number;
    lastUpdated: Date;
    voiceChannelId: string | null;
    textChannelId: string | null;
    isPaused: boolean;
  } {
    return {
      guildId: this._guildId.value,
      state: this._state,
      currentTrack: this._currentTrack,
      volume: this._volume,
      position: this._position,
      loopMode: this._loopMode,
      queueLength: this._queueLength,
      lastUpdated: this._lastUpdated,
      voiceChannelId: this._voiceChannelId,
      textChannelId: this._textChannelId,
      isPaused: this._isPaused
    };
  }
}
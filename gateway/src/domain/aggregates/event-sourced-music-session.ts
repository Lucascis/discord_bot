import { EventSourcedAggregateRoot } from '@discord-bot/event-store';
import type { DomainEvent } from '@discord-bot/event-store';
import { GuildId } from '../value-objects/guild-id.js';

export type SessionState = 'idle' | 'playing' | 'paused' | 'stopped';
export type LoopMode = 'off' | 'track' | 'queue';

/**
 * Event Sourced Music Session Aggregate
 * Implements music session using Event Sourcing pattern
 */
export class EventSourcedMusicSession extends EventSourcedAggregateRoot {
  private _guildId: GuildId;
  private _state: SessionState = 'idle';
  private _currentTrack: string | null = null;
  private _volume: number = 100;
  private _position: number = 0;
  private _loopMode: LoopMode = 'off';
  private _queueLength: number = 0;
  private _voiceChannelId: string | null = null;
  private _textChannelId: string | null = null;
  private _isPaused: boolean = false;
  private _lastUpdated: Date = new Date();

  constructor(guildId: string) {
    super(guildId);
    this._guildId = GuildId.from(guildId);
  }

  // Getters
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

  get lastUpdated(): Date {
    return this._lastUpdated;
  }

  // Commands (Business Operations)
  startPlaying(trackTitle: string, voiceChannelId: string, textChannelId: string, userId: string): void {
    this.raiseEvent('MusicSessionStarted', {
      trackTitle,
      voiceChannelId,
      textChannelId,
      userId,
      volume: this._volume
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  pause(userId: string): void {
    if (this._state !== 'playing') {
      throw new Error('Cannot pause session that is not playing');
    }

    this.raiseEvent('MusicSessionPaused', {
      previousState: this._state,
      currentPosition: this._position,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  resume(userId: string): void {
    if (this._state !== 'paused') {
      throw new Error('Cannot resume session that is not paused');
    }

    this.raiseEvent('MusicSessionResumed', {
      previousState: this._state,
      currentPosition: this._position,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  stop(userId: string): void {
    if (!this.isActive) {
      throw new Error('Cannot stop inactive session');
    }

    this.raiseEvent('MusicSessionStopped', {
      previousState: this._state,
      finalPosition: this._position,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  disconnect(userId: string): void {
    this.raiseEvent('MusicSessionDisconnected', {
      previousState: this._state,
      userId,
      voiceChannelId: this._voiceChannelId,
      textChannelId: this._textChannelId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  setVolume(volume: number, userId: string): void {
    this.validateVolume(volume);

    this.raiseEvent('VolumeChanged', {
      previousVolume: this._volume,
      newVolume: volume,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  setPosition(position: number, userId: string): void {
    if (position < 0) {
      throw new Error('Position cannot be negative');
    }

    this.raiseEvent('PositionChanged', {
      previousPosition: this._position,
      newPosition: position,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  setLoopMode(mode: LoopMode, userId: string): void {
    this.raiseEvent('LoopModeChanged', {
      previousMode: this._loopMode,
      newMode: mode,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  addToQueue(trackTitle: string, trackUri: string, userId: string): void {
    this.raiseEvent('TrackAddedToQueue', {
      trackTitle,
      trackUri,
      queuePosition: this._queueLength + 1,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  skipToNext(userId: string): void {
    if (this._queueLength === 0) {
      throw new Error('Cannot skip when queue is empty');
    }

    this.raiseEvent('TrackSkipped', {
      skippedTrack: this._currentTrack,
      queueLength: this._queueLength,
      userId
    }, {
      userId,
      guildId: this._guildId.value
    });
  }

  // Event Handlers
  protected applyEvent(event: DomainEvent, _isNew: boolean): void {
    switch (event.eventType) {
      case 'MusicSessionStarted':
        this.onMusicSessionStarted(event);
        break;
      case 'MusicSessionPaused':
        this.onMusicSessionPaused(event);
        break;
      case 'MusicSessionResumed':
        this.onMusicSessionResumed(event);
        break;
      case 'MusicSessionStopped':
        this.onMusicSessionStopped(event);
        break;
      case 'MusicSessionDisconnected':
        this.onMusicSessionDisconnected(event);
        break;
      case 'VolumeChanged':
        this.onVolumeChanged(event);
        break;
      case 'PositionChanged':
        this.onPositionChanged(event);
        break;
      case 'LoopModeChanged':
        this.onLoopModeChanged(event);
        break;
      case 'TrackAddedToQueue':
        this.onTrackAddedToQueue(event);
        break;
      case 'TrackSkipped':
        this.onTrackSkipped(event);
        break;
      default:
        // Unknown event type, ignore
        break;
    }

    this._lastUpdated = event.timestamp;
  }

  private onMusicSessionStarted(event: DomainEvent): void {
    const { trackTitle, voiceChannelId, textChannelId, volume } = event.eventData;

    this._state = 'playing';
    this._currentTrack = trackTitle as string;
    this._voiceChannelId = voiceChannelId as string;
    this._textChannelId = textChannelId as string;
    this._volume = (volume as number) ?? 100;
    this._isPaused = false;
    this._position = 0;
  }

  private onMusicSessionPaused(event: DomainEvent): void {
    this._state = 'paused';
    this._isPaused = true;
    this._position = (event.eventData.currentPosition as number) ?? this._position;
  }

  private onMusicSessionResumed(_event: DomainEvent): void {
    this._state = 'playing';
    this._isPaused = false;
  }

  private onMusicSessionStopped(_event: DomainEvent): void {
    this._state = 'stopped';
    this._currentTrack = null;
    this._position = 0;
    this._isPaused = false;
  }

  private onMusicSessionDisconnected(_event: DomainEvent): void {
    this._state = 'idle';
    this._currentTrack = null;
    this._voiceChannelId = null;
    this._textChannelId = null;
    this._position = 0;
    this._isPaused = false;
    this._queueLength = 0;
  }

  private onVolumeChanged(event: DomainEvent): void {
    this._volume = event.eventData.newVolume as number;
  }

  private onPositionChanged(event: DomainEvent): void {
    this._position = event.eventData.newPosition as number;
  }

  private onLoopModeChanged(event: DomainEvent): void {
    this._loopMode = event.eventData.newMode as LoopMode;
  }

  private onTrackAddedToQueue(_event: DomainEvent): void {
    this._queueLength += 1;
  }

  private onTrackSkipped(_event: DomainEvent): void {
    this._queueLength = Math.max(0, this._queueLength - 1);
    this._position = 0;
  }

  protected getAggregateType(): string {
    return 'MusicSession';
  }

  private validateVolume(volume: number): void {
    if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
      throw new Error('Volume must be an integer between 0 and 200');
    }
  }

  // Factory methods
  static create(guildId: string): EventSourcedMusicSession {
    return new EventSourcedMusicSession(guildId);
  }

  // Convert to snapshot data
  toSnapshot(): Record<string, unknown> {
    return {
      guildId: this._guildId.value,
      state: this._state,
      currentTrack: this._currentTrack,
      volume: this._volume,
      position: this._position,
      loopMode: this._loopMode,
      queueLength: this._queueLength,
      voiceChannelId: this._voiceChannelId,
      textChannelId: this._textChannelId,
      isPaused: this._isPaused,
      lastUpdated: this._lastUpdated.toISOString()
    };
  }

  // Restore from snapshot data
  static fromSnapshot(guildId: string, data: Record<string, unknown>): EventSourcedMusicSession {
    const session = new EventSourcedMusicSession(guildId);

    session._state = (data.state as SessionState) ?? 'idle';
    session._currentTrack = (data.currentTrack as string) ?? null;
    session._volume = (data.volume as number) ?? 100;
    session._position = (data.position as number) ?? 0;
    session._loopMode = (data.loopMode as LoopMode) ?? 'off';
    session._queueLength = (data.queueLength as number) ?? 0;
    session._voiceChannelId = (data.voiceChannelId as string) ?? null;
    session._textChannelId = (data.textChannelId as string) ?? null;
    session._isPaused = (data.isPaused as boolean) ?? false;
    session._lastUpdated = data.lastUpdated
      ? new Date(data.lastUpdated as string)
      : new Date();

    return session;
  }
}
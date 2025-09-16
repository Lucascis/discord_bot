/**
 * Base Domain Event
 * All domain events should extend this base class
 */
export abstract class DomainEvent {
  protected constructor(
    public readonly eventId: string,
    public readonly occurredAt: Date,
    public readonly aggregateId: string,
    public readonly eventType: string
  ) {}

  static generateId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Music Session Events
 */
export class MusicSessionStartedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly trackTitle: string,
    public readonly voiceChannelId: string,
    public readonly textChannelId: string,
    public readonly userId: string
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'MusicSessionStarted'
    );
  }
}

export class MusicSessionPausedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly userId: string,
    public readonly position: number
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'MusicSessionPaused'
    );
  }
}

export class MusicSessionResumedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly userId: string,
    public readonly position: number
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'MusicSessionResumed'
    );
  }
}

export class MusicSessionStoppedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly userId: string,
    public readonly reason: 'user_requested' | 'error' | 'queue_ended'
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'MusicSessionStopped'
    );
  }
}

export class VolumeChangedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly oldVolume: number,
    public readonly newVolume: number,
    public readonly userId: string
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'VolumeChanged'
    );
  }
}

export class LoopModeChangedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly oldMode: string,
    public readonly newMode: string,
    public readonly userId: string
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'LoopModeChanged'
    );
  }
}

/**
 * Guild Settings Events
 */
export class AutomixEnabledEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly enabled: boolean,
    public readonly userId: string
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'AutomixEnabled'
    );
  }
}

export class DjRoleChangedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly oldRoleName: string | null,
    public readonly newRoleName: string | null,
    public readonly userId: string
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'DjRoleChanged'
    );
  }
}

/**
 * Search Events
 */
export class SearchRequestedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly query: string,
    public readonly userId: string,
    public readonly source: 'youtube' | 'spotify' | 'other'
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'SearchRequested'
    );
  }
}

export class SearchCompletedEvent extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly query: string,
    public readonly resultCount: number,
    public readonly latency: number,
    public readonly userId: string,
    public readonly cached: boolean
  ) {
    super(
      DomainEvent.generateId(),
      new Date(),
      aggregateId,
      'SearchCompleted'
    );
  }
}
import type { DomainEvent as EventStoreDomainEvent, EventMetadata } from '@discord-bot/event-store';

/**
 * Helper to create compatible domain events
 */
export function createDomainEvent(
  eventType: string,
  aggregateId: string,
  aggregateType: string,
  eventData: Record<string, unknown>,
  metadata: Partial<EventMetadata> = {}
): EventStoreDomainEvent {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    aggregateId,
    aggregateType,
    aggregateVersion: 1,
    eventData,
    metadata: {
      source: 'gateway-service',
      version: '1.0.0',
      ...metadata,
    },
    timestamp: new Date(),
  };
}

/**
 * Music Session Events
 */
export function MusicSessionStartedEvent(
  aggregateId: string,
  trackTitle: string,
  voiceChannelId: string,
  textChannelId: string,
  userId: string
): EventStoreDomainEvent {
  return createDomainEvent(
    'MusicSessionStarted',
    aggregateId,
    'MusicSession',
    { trackTitle, voiceChannelId, textChannelId, userId },
    { userId }
  );
}

export function MusicSessionPausedEvent(
  aggregateId: string,
  userId: string,
  position: number
): EventStoreDomainEvent {
  return createDomainEvent(
    'MusicSessionPaused',
    aggregateId,
    'MusicSession',
    { userId, position },
    { userId }
  );
}

export function MusicSessionResumedEvent(
  aggregateId: string,
  userId: string,
  position: number
): EventStoreDomainEvent {
  return createDomainEvent(
    'MusicSessionResumed',
    aggregateId,
    'MusicSession',
    { userId, position },
    { userId }
  );
}

export function MusicSessionStoppedEvent(
  aggregateId: string,
  userId: string,
  reason: 'user_requested' | 'error' | 'queue_ended'
): EventStoreDomainEvent {
  return createDomainEvent(
    'MusicSessionStopped',
    aggregateId,
    'MusicSession',
    { userId, reason },
    { userId }
  );
}

export function VolumeChangedEvent(
  aggregateId: string,
  oldVolume: number,
  newVolume: number,
  userId: string
): EventStoreDomainEvent {
  return createDomainEvent(
    'VolumeChanged',
    aggregateId,
    'MusicSession',
    { oldVolume, newVolume, userId },
    { userId }
  );
}

export function LoopModeChangedEvent(
  aggregateId: string,
  oldMode: string,
  newMode: string,
  userId: string
): EventStoreDomainEvent {
  return createDomainEvent(
    'LoopModeChanged',
    aggregateId,
    'MusicSession',
    { oldMode, newMode, userId },
    { userId }
  );
}

/**
 * Guild Settings Events
 */
export function AutomixEnabledEvent(
  aggregateId: string,
  enabled: boolean,
  userId: string
): EventStoreDomainEvent {
  return createDomainEvent(
    'AutomixEnabled',
    aggregateId,
    'GuildSettings',
    { enabled, userId },
    { userId, guildId: aggregateId }
  );
}

export function DjRoleChangedEvent(
  aggregateId: string,
  oldRoleName: string | null,
  newRoleName: string | null,
  userId: string
): EventStoreDomainEvent {
  return createDomainEvent(
    'DjRoleChanged',
    aggregateId,
    'GuildSettings',
    { oldRoleName, newRoleName, userId },
    { userId, guildId: aggregateId }
  );
}

/**
 * Search Events
 */
export function SearchRequestedEvent(
  aggregateId: string,
  query: string,
  userId: string,
  source: 'youtube' | 'spotify' | 'other'
): EventStoreDomainEvent {
  return createDomainEvent(
    'SearchRequested',
    aggregateId,
    'SearchSession',
    { query, userId, source },
    { userId, guildId: aggregateId }
  );
}

export function SearchCompletedEvent(
  aggregateId: string,
  query: string,
  resultCount: number,
  latency: number,
  userId: string,
  cached: boolean
): EventStoreDomainEvent {
  return createDomainEvent(
    'SearchCompleted',
    aggregateId,
    'SearchSession',
    { query, resultCount, latency, userId, cached },
    { userId, guildId: aggregateId }
  );
}
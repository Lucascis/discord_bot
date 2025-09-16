/**
 * Base Domain Event Interface
 * Foundation for all events in the system
 */
export interface DomainEvent {
  /** Unique event identifier */
  eventId: string;

  /** Type of event (e.g., 'MusicSessionStarted', 'TrackAdded') */
  eventType: string;

  /** ID of the aggregate that generated this event */
  aggregateId: string;

  /** Type of aggregate (e.g., 'MusicSession', 'GuildSettings') */
  aggregateType: string;

  /** Version of the aggregate when this event was generated */
  aggregateVersion: number;

  /** Event payload/data */
  eventData: Record<string, unknown>;

  /** Event metadata (user, correlation ID, etc.) */
  metadata: EventMetadata;

  /** When the event occurred */
  timestamp: Date;
}

/**
 * Event Metadata
 * Additional context about the event
 */
export interface EventMetadata {
  /** User who triggered the event */
  userId?: string;

  /** Guild where the event occurred */
  guildId?: string;

  /** Correlation ID for tracing related events */
  correlationId?: string;

  /** Causation ID for event chains */
  causationId?: string;

  /** Source service that generated the event */
  source: string;

  /** Version of the event schema */
  version: string;

  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Event Store Entry
 * How events are persisted in the store
 */
export interface EventStoreEntry {
  /** Primary key */
  id: number;

  /** Event details */
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;

  /** Serialized event data */
  eventData: string;
  metadata: string;

  /** Timestamps */
  timestamp: Date;
  createdAt: Date;

  /** Event position in global stream */
  globalPosition: number;
}

/**
 * Event Stream
 * Collection of events for an aggregate
 */
export interface EventStream {
  aggregateId: string;
  aggregateType: string;
  events: DomainEvent[];
  version: number;
}

/**
 * Event Store Query Options
 */
export interface EventStoreQueryOptions {
  /** Starting position in the event stream */
  fromVersion?: number;

  /** Maximum number of events to return */
  limit?: number;

  /** Filter by event types */
  eventTypes?: string[];

  /** Filter by date range */
  fromDate?: Date;
  toDate?: Date;

  /** Include metadata in results */
  includeMetadata?: boolean;
}

/**
 * Snapshot for Event Sourcing
 * Periodic snapshots to optimize event replay
 */
export interface AggregateSnapshot {
  aggregateId: string;
  aggregateType: string;
  version: number;
  data: Record<string, unknown>;
  timestamp: Date;
}
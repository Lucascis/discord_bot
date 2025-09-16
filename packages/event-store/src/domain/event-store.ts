import type {
  DomainEvent,
  EventStream,
  EventStoreQueryOptions,
  AggregateSnapshot
} from './event.js';

/**
 * Event Store Interface
 * Primary interface for event persistence and retrieval
 */
export interface IEventStore {
  /**
   * Append events to an aggregate stream
   * Ensures optimistic concurrency control
   */
  appendEvents(
    aggregateId: string,
    aggregateType: string,
    events: DomainEvent[],
    expectedVersion: number
  ): Promise<void>;

  /**
   * Get all events for an aggregate
   */
  getAggregateEvents(
    aggregateId: string,
    aggregateType: string,
    options?: EventStoreQueryOptions
  ): Promise<EventStream>;

  /**
   * Get events from global stream
   * Useful for projections and read models
   */
  getGlobalEvents(
    options?: EventStoreQueryOptions & { fromPosition?: number }
  ): Promise<DomainEvent[]>;

  /**
   * Get events by event type
   * Useful for event handlers and projections
   */
  getEventsByType(
    eventType: string | string[],
    options?: EventStoreQueryOptions
  ): Promise<DomainEvent[]>;

  /**
   * Save aggregate snapshot
   */
  saveSnapshot(snapshot: AggregateSnapshot): Promise<void>;

  /**
   * Load latest snapshot for aggregate
   */
  loadSnapshot(
    aggregateId: string,
    aggregateType: string
  ): Promise<AggregateSnapshot | null>;

  /**
   * Get the current version of an aggregate
   */
  getAggregateVersion(
    aggregateId: string,
    aggregateType: string
  ): Promise<number>;

  /**
   * Check if aggregate exists
   */
  aggregateExists(
    aggregateId: string,
    aggregateType: string
  ): Promise<boolean>;
}

/**
 * Event Store Configuration
 */
export interface EventStoreConfig {
  /** Database connection configuration */
  database: {
    connectionString?: string;
    poolSize?: number;
    timeout?: number;
  };

  /** Snapshot configuration */
  snapshots: {
    enabled: boolean;
    frequency: number; // Take snapshot every N events
    retention: number; // Keep snapshots for N days
  };

  /** Performance settings */
  performance: {
    batchSize: number; // Batch size for bulk operations
    cacheSize: number; // Number of events to cache in memory
    compressionEnabled: boolean;
  };

  /** Retry configuration */
  retry: {
    maxAttempts: number;
    backoffMs: number;
    maxBackoffMs: number;
  };
}

/**
 * Concurrency Exception
 * Thrown when optimistic concurrency control fails
 */
export class ConcurrencyException extends Error {
  constructor(
    public readonly aggregateId: string,
    public readonly aggregateType: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Concurrency conflict for ${aggregateType}:${aggregateId}. ` +
      `Expected version ${expectedVersion}, but actual version is ${actualVersion}`
    );
    this.name = 'ConcurrencyException';
  }
}

/**
 * Event Store Exception
 * Base exception for event store operations
 */
export class EventStoreException extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'EventStoreException';
  }
}
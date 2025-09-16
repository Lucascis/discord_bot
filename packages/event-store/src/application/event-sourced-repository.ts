import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';

import type { DomainEvent, EventMetadata } from '../domain/event.js';
import type { IEventStore } from '../domain/event-store.js';

/**
 * Event Sourced Aggregate Root
 * Base class for aggregates that use event sourcing
 */
export abstract class EventSourcedAggregateRoot {
  protected _aggregateId: string;
  protected _version: number = 0;
  protected _uncommittedEvents: DomainEvent[] = [];

  constructor(aggregateId: string) {
    this._aggregateId = aggregateId;
  }

  get aggregateId(): string {
    return this._aggregateId;
  }

  get version(): number {
    return this._version;
  }

  get hasUncommittedEvents(): boolean {
    return this._uncommittedEvents.length > 0;
  }

  /**
   * Get uncommitted events and clear them
   */
  getUncommittedEvents(): DomainEvent[] {
    const events = [...this._uncommittedEvents];
    this._uncommittedEvents = [];
    return events;
  }

  /**
   * Replay events to rebuild aggregate state
   */
  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.applyEvent(event, false);
      this._version = event.aggregateVersion;
    }
  }

  /**
   * Apply and record new event
   */
  protected raiseEvent(
    eventType: string,
    eventData: Record<string, unknown>,
    metadata: Partial<EventMetadata> = {}
  ): void {
    const event: DomainEvent = {
      eventId: uuidv4(),
      eventType,
      aggregateId: this._aggregateId,
      aggregateType: this.getAggregateType(),
      aggregateVersion: this._version + 1,
      eventData,
      metadata: {
        ...metadata,
        source: metadata.source ?? 'gateway-service',
        version: metadata.version ?? '1.0'
      } as EventMetadata,
      timestamp: new Date()
    };

    this.applyEvent(event, true);
    this._uncommittedEvents.push(event);
    this._version = event.aggregateVersion;
  }

  /**
   * Apply event to aggregate state
   * @param event The event to apply
   * @param isNew Whether this is a new event or from history
   */
  protected abstract applyEvent(event: DomainEvent, isNew: boolean): void;

  /**
   * Get the aggregate type name
   */
  protected abstract getAggregateType(): string;

  /**
   * Mark events as committed
   */
  markEventsAsCommitted(): void {
    this._uncommittedEvents = [];
  }
}

/**
 * Event Sourced Repository
 * Base repository for event sourced aggregates
 */
export abstract class EventSourcedRepository<T extends EventSourcedAggregateRoot> {
  protected readonly eventStore: IEventStore;

  constructor(eventStore: IEventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Load aggregate from event store
   */
  async load(aggregateId: string): Promise<T | null> {
    try {
      // Try to load from snapshot first
      const snapshot = await this.eventStore.loadSnapshot(
        aggregateId,
        this.getAggregateType()
      );

      let aggregate: T;
      let fromVersion = 0;

      if (snapshot) {
        // Restore from snapshot
        aggregate = this.createFromSnapshot(aggregateId, snapshot.data);
        (aggregate as any)._version = snapshot.version;
        fromVersion = snapshot.version;
      } else {
        // Create new aggregate
        aggregate = this.createEmpty(aggregateId);
      }

      // Load events since snapshot
      const eventStream = await this.eventStore.getAggregateEvents(
        aggregateId,
        this.getAggregateType(),
        { fromVersion }
      );

      if (eventStream.events.length === 0 && !snapshot) {
        return null; // Aggregate doesn't exist
      }

      // Apply events to rebuild state
      aggregate.loadFromHistory(eventStream.events);

      return aggregate;

    } catch (error) {
      logger.error('Failed to load aggregate', {
        aggregateId,
        aggregateType: this.getAggregateType(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save aggregate to event store
   */
  async save(aggregate: T): Promise<void> {
    if (!aggregate.hasUncommittedEvents) {
      return; // Nothing to save
    }

    try {
      const expectedVersion = aggregate.version - aggregate.getUncommittedEvents().length;
      const events = aggregate.getUncommittedEvents();

      await this.eventStore.appendEvents(
        aggregate.aggregateId,
        this.getAggregateType(),
        events,
        expectedVersion
      );

      aggregate.markEventsAsCommitted();

      logger.debug('Aggregate saved successfully', {
        aggregateId: aggregate.aggregateId,
        aggregateType: this.getAggregateType(),
        eventCount: events.length,
        newVersion: aggregate.version
      });

    } catch (error) {
      logger.error('Failed to save aggregate', {
        aggregateId: aggregate.aggregateId,
        aggregateType: this.getAggregateType(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if aggregate exists
   */
  async exists(aggregateId: string): Promise<boolean> {
    return await this.eventStore.aggregateExists(aggregateId, this.getAggregateType());
  }

  /**
   * Get current version of aggregate
   */
  async getVersion(aggregateId: string): Promise<number> {
    return await this.eventStore.getAggregateVersion(aggregateId, this.getAggregateType());
  }

  /**
   * Create aggregate from snapshot data
   */
  protected abstract createFromSnapshot(aggregateId: string, snapshotData: Record<string, unknown>): T;

  /**
   * Create empty aggregate
   */
  protected abstract createEmpty(aggregateId: string): T;

  /**
   * Get aggregate type name
   */
  protected abstract getAggregateType(): string;
}

/**
 * Event Handler Interface
 * For handling domain events
 */
export interface IEventHandler<T extends DomainEvent = DomainEvent> {
  eventType: string;
  handle(event: T): Promise<void>;
}

/**
 * Event Bus Interface
 * For publishing and subscribing to events
 */
export interface IEventBus {
  publish(events: DomainEvent[]): Promise<void>;
  subscribe<T extends DomainEvent>(eventType: string, handler: IEventHandler<T>): void;
  unsubscribe(eventType: string, handler: IEventHandler): void;
}
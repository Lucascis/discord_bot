import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';
/**
 * Event Sourced Aggregate Root
 * Base class for aggregates that use event sourcing
 */
export class EventSourcedAggregateRoot {
    constructor(aggregateId) {
        this._version = 0;
        this._uncommittedEvents = [];
        this._aggregateId = aggregateId;
    }
    get aggregateId() {
        return this._aggregateId;
    }
    get version() {
        return this._version;
    }
    get hasUncommittedEvents() {
        return this._uncommittedEvents.length > 0;
    }
    /**
     * Get uncommitted events and clear them
     */
    getUncommittedEvents() {
        const events = [...this._uncommittedEvents];
        this._uncommittedEvents = [];
        return events;
    }
    /**
     * Replay events to rebuild aggregate state
     */
    loadFromHistory(events) {
        for (const event of events) {
            this.applyEvent(event, false);
            this._version = event.aggregateVersion;
        }
    }
    /**
     * Apply and record new event
     */
    raiseEvent(eventType, eventData, metadata = {}) {
        const event = {
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
            },
            timestamp: new Date()
        };
        this.applyEvent(event, true);
        this._uncommittedEvents.push(event);
        this._version = event.aggregateVersion;
    }
    /**
     * Mark events as committed
     */
    markEventsAsCommitted() {
        this._uncommittedEvents = [];
    }
}
/**
 * Event Sourced Repository
 * Base repository for event sourced aggregates
 */
export class EventSourcedRepository {
    constructor(eventStore) {
        this.eventStore = eventStore;
    }
    /**
     * Load aggregate from event store
     */
    async load(aggregateId) {
        try {
            // Try to load from snapshot first
            const snapshot = await this.eventStore.loadSnapshot(aggregateId, this.getAggregateType());
            let aggregate;
            let fromVersion = 0;
            if (snapshot) {
                // Restore from snapshot
                aggregate = this.createFromSnapshot(aggregateId, snapshot.data);
                aggregate._version = snapshot.version;
                fromVersion = snapshot.version;
            }
            else {
                // Create new aggregate
                aggregate = this.createEmpty(aggregateId);
            }
            // Load events since snapshot
            const eventStream = await this.eventStore.getAggregateEvents(aggregateId, this.getAggregateType(), { fromVersion });
            if (eventStream.events.length === 0 && !snapshot) {
                return null; // Aggregate doesn't exist
            }
            // Apply events to rebuild state
            aggregate.loadFromHistory(eventStream.events);
            return aggregate;
        }
        catch (error) {
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
    async save(aggregate) {
        if (!aggregate.hasUncommittedEvents) {
            return; // Nothing to save
        }
        try {
            const expectedVersion = aggregate.version - aggregate.getUncommittedEvents().length;
            const events = aggregate.getUncommittedEvents();
            await this.eventStore.appendEvents(aggregate.aggregateId, this.getAggregateType(), events, expectedVersion);
            aggregate.markEventsAsCommitted();
            logger.debug('Aggregate saved successfully', {
                aggregateId: aggregate.aggregateId,
                aggregateType: this.getAggregateType(),
                eventCount: events.length,
                newVersion: aggregate.version
            });
        }
        catch (error) {
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
    async exists(aggregateId) {
        return await this.eventStore.aggregateExists(aggregateId, this.getAggregateType());
    }
    /**
     * Get current version of aggregate
     */
    async getVersion(aggregateId) {
        return await this.eventStore.getAggregateVersion(aggregateId, this.getAggregateType());
    }
}

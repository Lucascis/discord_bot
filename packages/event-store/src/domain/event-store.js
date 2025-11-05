/**
 * Concurrency Exception
 * Thrown when optimistic concurrency control fails
 */
export class ConcurrencyException extends Error {
    constructor(aggregateId, aggregateType, expectedVersion, actualVersion) {
        super(`Concurrency conflict for ${aggregateType}:${aggregateId}. ` +
            `Expected version ${expectedVersion}, but actual version is ${actualVersion}`);
        this.aggregateId = aggregateId;
        this.aggregateType = aggregateType;
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
        this.name = 'ConcurrencyException';
    }
}
/**
 * Event Store Exception
 * Base exception for event store operations
 */
export class EventStoreException extends Error {
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'EventStoreException';
    }
}

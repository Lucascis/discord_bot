import { logger } from '@discord-bot/logger';
import { ConcurrencyException, EventStoreException } from '../domain/event-store.js';
/**
 * PostgreSQL Event Store Implementation
 * Uses Prisma ORM for data persistence
 */
export class PostgresEventStore {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    async appendEvents(aggregateId, aggregateType, events, expectedVersion) {
        if (events.length === 0) {
            return;
        }
        try {
            await this.prisma.$transaction(async (tx) => {
                // Check current version for optimistic concurrency control
                const currentVersion = await this.getCurrentVersion(tx, aggregateId, aggregateType);
                if (currentVersion !== expectedVersion) {
                    throw new ConcurrencyException(aggregateId, aggregateType, expectedVersion, currentVersion);
                }
                // Append events
                for (let i = 0; i < events.length; i++) {
                    const event = events[i];
                    const version = expectedVersion + i + 1;
                    await tx.eventStoreEvent.create({
                        data: {
                            eventId: event.eventId,
                            eventType: event.eventType,
                            aggregateId: event.aggregateId,
                            aggregateType: event.aggregateType,
                            aggregateVersion: version,
                            eventData: JSON.stringify(event.eventData),
                            metadata: JSON.stringify(event.metadata),
                            timestamp: event.timestamp,
                        }
                    });
                }
                // Take snapshot if needed
                if (this.shouldTakeSnapshot(expectedVersion + events.length)) {
                    await this.takeSnapshotIfNeeded(aggregateId, aggregateType, expectedVersion + events.length);
                }
            });
            logger.info('Events appended successfully', {
                aggregateId,
                aggregateType,
                eventCount: events.length,
                newVersion: expectedVersion + events.length
            });
        }
        catch (error) {
            if (error instanceof ConcurrencyException) {
                throw error;
            }
            logger.error('Failed to append events', {
                aggregateId,
                aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to append events for ${aggregateType}:${aggregateId}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async getAggregateEvents(aggregateId, aggregateType, options = {}) {
        try {
            const events = await this.prisma.eventStoreEvent.findMany({
                where: {
                    aggregateId,
                    aggregateType,
                    aggregateVersion: options.fromVersion ? {
                        gt: options.fromVersion
                    } : undefined,
                    eventType: options.eventTypes ? {
                        in: options.eventTypes
                    } : undefined,
                    timestamp: this.buildDateFilter(options.fromDate, options.toDate)
                },
                orderBy: {
                    aggregateVersion: 'asc'
                },
                take: options.limit
            });
            const domainEvents = events.map((e) => this.mapToDomainEvent(e));
            const version = events.length > 0
                ? Math.max(...events.map((e) => e.aggregateVersion))
                : 0;
            return {
                aggregateId,
                aggregateType,
                events: domainEvents,
                version
            };
        }
        catch (error) {
            logger.error('Failed to get aggregate events', {
                aggregateId,
                aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to get events for ${aggregateType}:${aggregateId}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async getGlobalEvents(options = {}) {
        try {
            const events = await this.prisma.eventStoreEvent.findMany({
                where: {
                    globalPosition: options.fromPosition ? {
                        gt: options.fromPosition
                    } : undefined,
                    eventType: options.eventTypes ? {
                        in: options.eventTypes
                    } : undefined,
                    timestamp: this.buildDateFilter(options.fromDate, options.toDate)
                },
                orderBy: {
                    globalPosition: 'asc'
                },
                take: options.limit
            });
            return events.map(this.mapToDomainEvent);
        }
        catch (error) {
            logger.error('Failed to get global events', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException('Failed to get global events', error instanceof Error ? error : new Error(String(error)));
        }
    }
    async getEventsByType(eventType, options = {}) {
        try {
            const eventTypes = Array.isArray(eventType) ? eventType : [eventType];
            const events = await this.prisma.eventStoreEvent.findMany({
                where: {
                    eventType: {
                        in: eventTypes
                    },
                    timestamp: this.buildDateFilter(options.fromDate, options.toDate)
                },
                orderBy: {
                    timestamp: 'asc'
                },
                take: options.limit
            });
            return events.map(this.mapToDomainEvent);
        }
        catch (error) {
            logger.error('Failed to get events by type', {
                eventType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to get events by type: ${eventType}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async saveSnapshot(snapshot) {
        try {
            await this.prisma.eventStoreSnapshot.upsert({
                where: {
                    aggregateId_aggregateType: {
                        aggregateId: snapshot.aggregateId,
                        aggregateType: snapshot.aggregateType
                    }
                },
                create: {
                    aggregateId: snapshot.aggregateId,
                    aggregateType: snapshot.aggregateType,
                    version: snapshot.version,
                    data: JSON.stringify(snapshot.data),
                    timestamp: snapshot.timestamp
                },
                update: {
                    version: snapshot.version,
                    data: JSON.stringify(snapshot.data),
                    timestamp: snapshot.timestamp
                }
            });
            logger.info('Snapshot saved', {
                aggregateId: snapshot.aggregateId,
                aggregateType: snapshot.aggregateType,
                version: snapshot.version
            });
        }
        catch (error) {
            logger.error('Failed to save snapshot', {
                aggregateId: snapshot.aggregateId,
                aggregateType: snapshot.aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to save snapshot for ${snapshot.aggregateType}:${snapshot.aggregateId}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async loadSnapshot(aggregateId, aggregateType) {
        try {
            const snapshot = await this.prisma.eventStoreSnapshot.findUnique({
                where: {
                    aggregateId_aggregateType: {
                        aggregateId,
                        aggregateType
                    }
                }
            });
            if (!snapshot) {
                return null;
            }
            return {
                aggregateId: snapshot.aggregateId,
                aggregateType: snapshot.aggregateType,
                version: snapshot.version,
                data: JSON.parse(snapshot.data),
                timestamp: snapshot.timestamp
            };
        }
        catch (error) {
            logger.error('Failed to load snapshot', {
                aggregateId,
                aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to load snapshot for ${aggregateType}:${aggregateId}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async getAggregateVersion(aggregateId, aggregateType) {
        try {
            const result = await this.prisma.eventStoreEvent.findFirst({
                where: {
                    aggregateId,
                    aggregateType
                },
                orderBy: {
                    aggregateVersion: 'desc'
                },
                select: {
                    aggregateVersion: true
                }
            });
            return result?.aggregateVersion ?? 0;
        }
        catch (error) {
            logger.error('Failed to get aggregate version', {
                aggregateId,
                aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new EventStoreException(`Failed to get version for ${aggregateType}:${aggregateId}`, error instanceof Error ? error : new Error(String(error)));
        }
    }
    async aggregateExists(aggregateId, aggregateType) {
        try {
            const count = await this.prisma.eventStoreEvent.count({
                where: {
                    aggregateId,
                    aggregateType
                }
            });
            return count > 0;
        }
        catch (error) {
            logger.error('Failed to check if aggregate exists', {
                aggregateId,
                aggregateType,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
    async getCurrentVersion(tx, aggregateId, aggregateType) {
        const result = await tx.eventStoreEvent.findFirst({
            where: {
                aggregateId,
                aggregateType
            },
            orderBy: {
                aggregateVersion: 'desc'
            },
            select: {
                aggregateVersion: true
            }
        });
        return result?.aggregateVersion ?? 0;
    }
    shouldTakeSnapshot(version) {
        return this.config.snapshots.enabled &&
            version % this.config.snapshots.frequency === 0;
    }
    async takeSnapshotIfNeeded(aggregateId, aggregateType, version) {
        // This would be implemented based on the specific aggregate type
        // For now, we'll skip automatic snapshot creation
        logger.debug('Snapshot needed but not implemented for automatic creation', {
            aggregateId,
            aggregateType,
            version
        });
    }
    buildDateFilter(fromDate, toDate) {
        if (!fromDate && !toDate) {
            return undefined;
        }
        const filter = {};
        if (fromDate) {
            filter.gte = fromDate;
        }
        if (toDate) {
            filter.lte = toDate;
        }
        return filter;
    }
    mapToDomainEvent(event) {
        return {
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            aggregateVersion: event.aggregateVersion,
            eventData: JSON.parse(event.eventData),
            metadata: JSON.parse(event.metadata),
            timestamp: event.timestamp
        };
    }
}

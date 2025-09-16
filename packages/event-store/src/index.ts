// Domain exports
export type {
  DomainEvent,
  EventMetadata,
  EventStoreEntry,
  EventStream,
  EventStoreQueryOptions,
  AggregateSnapshot
} from './domain/event.js';

export type {
  IEventStore,
  EventStoreConfig
} from './domain/event-store.js';

export {
  ConcurrencyException,
  EventStoreException
} from './domain/event-store.js';

// Infrastructure exports
export { PostgresEventStore } from './infrastructure/postgres-event-store.js';

// Application exports
export {
  EventSourcedAggregateRoot,
  EventSourcedRepository
} from './application/event-sourced-repository.js';

export type {
  IEventHandler,
  IEventBus
} from './application/event-sourced-repository.js';
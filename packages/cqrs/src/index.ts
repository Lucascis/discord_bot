// Command exports
export type {
  ICommand,
  CommandMetadata,
  ICommandHandler,
  CommandResult,
  ICommandBus
} from './commands/command-bus.js';

export {
  CommandBus,
  BaseCommand,
  CommandValidationError
} from './commands/command-bus.js';

// Query exports
export type {
  IQuery,
  QueryMetadata,
  IQueryHandler,
  QueryResult,
  IQueryBus
} from './queries/query-bus.js';

export {
  QueryBus,
  BaseQuery,
  QueryValidationError
} from './queries/query-bus.js';

// Projection exports
export type {
  IProjection,
  ProjectionState
} from './projections/projection-manager.js';

export {
  ProjectionManager
} from './projections/projection-manager.js';
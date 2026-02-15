import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';

const serializeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : error;

/**
 * Base Query Interface
 * All queries must extend this interface
 */
export interface IQuery {
  readonly queryId: string;
  readonly queryType: string;
  readonly timestamp: Date;
  readonly metadata: QueryMetadata;
}

/**
 * Query Metadata
 * Additional context about the query
 */
export interface QueryMetadata {
  userId?: string;
  guildId?: string;
  correlationId?: string;
  source: string;
  version: string;
  context?: Record<string, unknown>;
}

/**
 * Query Handler Interface
 * Defines contract for query handlers
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IQueryHandler<TQuery extends IQuery = IQuery, TResult = any> {
  readonly queryType: string;
  handle(query: TQuery): Promise<TResult>;
}

/**
 * Query Execution Result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueryResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query Bus Interface
 * Responsible for routing queries to their handlers
 */
export interface IQueryBus {
  registerHandler<TQuery extends IQuery, TResult>(
    handler: IQueryHandler<TQuery, TResult>
  ): void;

  ask<TQuery extends IQuery, TResult>(
    query: TQuery
  ): Promise<QueryResult<TResult>>;

  askBatch<TQuery extends IQuery>(
    queries: TQuery[]
  ): Promise<QueryResult[]>;
}

/**
 * Query Bus Implementation
 * In-memory query bus with handler registration
 */
export class QueryBus implements IQueryBus {
  private readonly handlers = new Map<string, IQueryHandler>();

  registerHandler<TQuery extends IQuery, TResult>(
    handler: IQueryHandler<TQuery, TResult>
  ): void {
    if (this.handlers.has(handler.queryType)) {
      throw new Error(`Handler for query type '${handler.queryType}' is already registered`);
    }

    this.handlers.set(handler.queryType, handler);
    logger.info({
      queryType: handler.queryType,
      handlerName: handler.constructor.name
    }, 'Query handler registered');
  }

  async ask<TQuery extends IQuery, TResult>(
    query: TQuery
  ): Promise<QueryResult<TResult>> {
    const startTime = Date.now();

    try {
      const handler = this.handlers.get(query.queryType);
      if (!handler) {
        const error = `No handler registered for query type: ${query.queryType}`;
        logger.error({
          queryType: query.queryType,
          queryId: query.queryId
        }, 'Query handler not found');

        return {
          success: false,
          error
        };
      }

      logger.debug({
        queryType: query.queryType,
        queryId: query.queryId,
        userId: query.metadata.userId,
        guildId: query.metadata.guildId
      }, 'Executing query');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handler.handle(query as any);

      const executionTime = Date.now() - startTime;
      logger.debug({
        queryType: query.queryType,
        queryId: query.queryId,
        executionTimeMs: executionTime,
        userId: query.metadata.userId,
        guildId: query.metadata.guildId
      }, 'Query executed successfully');

      return {
        success: true,
        data: result,
        metadata: {
          executionTimeMs: executionTime,
          handlerName: handler.constructor.name,
          fromCache: false // Will be set by caching decorators
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({
        queryType: query.queryType,
        queryId: query.queryId,
        error: serializeError(error),
        executionTimeMs: executionTime,
        userId: query.metadata.userId,
        guildId: query.metadata.guildId
      }, 'Query execution failed');

      return {
        success: false,
        error: errorMessage,
        metadata: {
          executionTimeMs: executionTime
        }
      };
    }
  }

  async askBatch<TQuery extends IQuery>(
    queries: TQuery[]
  ): Promise<QueryResult[]> {
    if (queries.length === 0) {
      return [];
    }

    logger.debug({
      batchSize: queries.length,
      queryTypes: [...new Set(queries.map(q => q.queryType))]
    }, 'Executing query batch');

    const results = await Promise.allSettled(
      queries.map(query => this.ask(query))
    );

    return results.map(result =>
      result.status === 'fulfilled'
        ? result.value
        : {
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          }
    );
  }

  /**
   * Get registered query types
   */
  getRegisteredQueryTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if handler is registered for query type
   */
  hasHandler(queryType: string): boolean {
    return this.handlers.has(queryType);
  }
}

/**
 * Base Query Class
 * Provides common query functionality
 */
export abstract class BaseQuery implements IQuery {
  public readonly queryId: string;
  public readonly timestamp: Date;
  public readonly metadata: QueryMetadata;

  constructor(
    public readonly queryType: string,
    metadata: Partial<QueryMetadata> = {}
  ) {
    this.queryId = uuidv4();
    this.timestamp = new Date();
    this.metadata = {
      source: 'gateway-service',
      version: '1.0',
      ...metadata
    };
  }
}

/**
 * Query Validation Error
 */
export class QueryValidationError extends Error {
  constructor(
    public readonly queryType: string,
    public readonly validationErrors: string[]
  ) {
    super(`Query validation failed: ${validationErrors.join(', ')}`);
    this.name = 'QueryValidationError';
  }
}

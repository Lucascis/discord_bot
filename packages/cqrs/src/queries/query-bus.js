import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';
/**
 * Query Bus Implementation
 * In-memory query bus with handler registration
 */
export class QueryBus {
    constructor() {
        this.handlers = new Map();
    }
    registerHandler(handler) {
        if (this.handlers.has(handler.queryType)) {
            throw new Error(`Handler for query type '${handler.queryType}' is already registered`);
        }
        this.handlers.set(handler.queryType, handler);
        logger.info('Query handler registered', {
            queryType: handler.queryType,
            handlerName: handler.constructor.name
        });
    }
    async ask(query) {
        const startTime = Date.now();
        try {
            const handler = this.handlers.get(query.queryType);
            if (!handler) {
                const error = `No handler registered for query type: ${query.queryType}`;
                logger.error('Query handler not found', {
                    queryType: query.queryType,
                    queryId: query.queryId
                });
                return {
                    success: false,
                    error
                };
            }
            logger.debug('Executing query', {
                queryType: query.queryType,
                queryId: query.queryId,
                userId: query.metadata.userId,
                guildId: query.metadata.guildId
            });
            const result = await handler.handle(query);
            const executionTime = Date.now() - startTime;
            logger.debug('Query executed successfully', {
                queryType: query.queryType,
                queryId: query.queryId,
                executionTimeMs: executionTime,
                userId: query.metadata.userId,
                guildId: query.metadata.guildId
            });
            return {
                success: true,
                data: result,
                metadata: {
                    executionTimeMs: executionTime,
                    handlerName: handler.constructor.name,
                    fromCache: false // Will be set by caching decorators
                }
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Query execution failed', {
                queryType: query.queryType,
                queryId: query.queryId,
                error: errorMessage,
                executionTimeMs: executionTime,
                userId: query.metadata.userId,
                guildId: query.metadata.guildId
            });
            return {
                success: false,
                error: errorMessage,
                metadata: {
                    executionTimeMs: executionTime
                }
            };
        }
    }
    async askBatch(queries) {
        if (queries.length === 0) {
            return [];
        }
        logger.debug('Executing query batch', {
            batchSize: queries.length,
            queryTypes: [...new Set(queries.map(q => q.queryType))]
        });
        const results = await Promise.allSettled(queries.map(query => this.ask(query)));
        return results.map(result => result.status === 'fulfilled'
            ? result.value
            : {
                success: false,
                error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
    }
    /**
     * Get registered query types
     */
    getRegisteredQueryTypes() {
        return Array.from(this.handlers.keys());
    }
    /**
     * Check if handler is registered for query type
     */
    hasHandler(queryType) {
        return this.handlers.has(queryType);
    }
}
/**
 * Base Query Class
 * Provides common query functionality
 */
export class BaseQuery {
    constructor(queryType, metadata = {}) {
        this.queryType = queryType;
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
    constructor(queryType, validationErrors) {
        super(`Query validation failed: ${validationErrors.join(', ')}`);
        this.queryType = queryType;
        this.validationErrors = validationErrors;
        this.name = 'QueryValidationError';
    }
}

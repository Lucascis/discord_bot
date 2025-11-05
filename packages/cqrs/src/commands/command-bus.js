import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';
/**
 * Command Bus Implementation
 * In-memory command bus with handler registration
 */
export class CommandBus {
    constructor() {
        this.handlers = new Map();
    }
    registerHandler(handler) {
        if (this.handlers.has(handler.commandType)) {
            throw new Error(`Handler for command type '${handler.commandType}' is already registered`);
        }
        this.handlers.set(handler.commandType, handler);
        logger.info('Command handler registered', {
            commandType: handler.commandType,
            handlerName: handler.constructor.name
        });
    }
    async send(command) {
        const startTime = Date.now();
        try {
            const handler = this.handlers.get(command.commandType);
            if (!handler) {
                const error = `No handler registered for command type: ${command.commandType}`;
                logger.error('Command handler not found', {
                    commandType: command.commandType,
                    commandId: command.commandId
                });
                return {
                    success: false,
                    error
                };
            }
            logger.debug('Executing command', {
                commandType: command.commandType,
                commandId: command.commandId,
                userId: command.metadata.userId,
                guildId: command.metadata.guildId
            });
            const result = await handler.handle(command);
            const executionTime = Date.now() - startTime;
            logger.info('Command executed successfully', {
                commandType: command.commandType,
                commandId: command.commandId,
                executionTimeMs: executionTime,
                userId: command.metadata.userId,
                guildId: command.metadata.guildId
            });
            return {
                success: true,
                data: result,
                metadata: {
                    executionTimeMs: executionTime,
                    handlerName: handler.constructor.name
                }
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Command execution failed', {
                commandType: command.commandType,
                commandId: command.commandId,
                error: errorMessage,
                executionTimeMs: executionTime,
                userId: command.metadata.userId,
                guildId: command.metadata.guildId
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
    async sendBatch(commands) {
        if (commands.length === 0) {
            return [];
        }
        logger.info('Executing command batch', {
            batchSize: commands.length,
            commandTypes: [...new Set(commands.map(c => c.commandType))]
        });
        const results = await Promise.allSettled(commands.map(command => this.send(command)));
        return results.map(result => result.status === 'fulfilled'
            ? result.value
            : {
                success: false,
                error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
    }
    /**
     * Get registered command types
     */
    getRegisteredCommandTypes() {
        return Array.from(this.handlers.keys());
    }
    /**
     * Check if handler is registered for command type
     */
    hasHandler(commandType) {
        return this.handlers.has(commandType);
    }
}
/**
 * Base Command Class
 * Provides common command functionality
 */
export class BaseCommand {
    constructor(commandType, metadata = {}) {
        this.commandType = commandType;
        this.commandId = uuidv4();
        this.timestamp = new Date();
        this.metadata = {
            source: 'gateway-service',
            version: '1.0',
            ...metadata
        };
    }
}
/**
 * Command Validation Error
 */
export class CommandValidationError extends Error {
    constructor(commandType, validationErrors) {
        super(`Command validation failed: ${validationErrors.join(', ')}`);
        this.commandType = commandType;
        this.validationErrors = validationErrors;
        this.name = 'CommandValidationError';
    }
}

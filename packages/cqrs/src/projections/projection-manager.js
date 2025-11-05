import { logger } from '@discord-bot/logger';
/**
 * Projection Manager
 * Manages and coordinates projection processing
 */
export class ProjectionManager {
    constructor(eventStore) {
        this.projections = new Map();
        this.projectionStates = new Map();
        this.pollingIntervals = new Map();
        this.config = {
            pollingIntervalMs: 5000,
            batchSize: 100,
            maxRetries: 3,
            retryDelayMs: 1000
        };
        this.eventStore = eventStore;
    }
    /**
     * Register a projection
     */
    registerProjection(projection) {
        if (this.projections.has(projection.projectionName)) {
            throw new Error(`Projection '${projection.projectionName}' is already registered`);
        }
        this.projections.set(projection.projectionName, projection);
        this.projectionStates.set(projection.projectionName, {
            projectionName: projection.projectionName,
            lastProcessedPosition: 0,
            lastProcessedAt: new Date(),
            isRunning: false,
            errorCount: 0
        });
        logger.info('Projection registered', {
            projectionName: projection.projectionName,
            eventTypes: projection.eventTypes
        });
    }
    /**
     * Start all projections
     */
    async startAll() {
        logger.info('Starting all projections', {
            projectionCount: this.projections.size
        });
        for (const [name, _projection] of this.projections) {
            await this.start(name);
        }
    }
    /**
     * Start a specific projection
     */
    async start(projectionName) {
        const projection = this.projections.get(projectionName);
        if (!projection) {
            throw new Error(`Projection '${projectionName}' not found`);
        }
        const state = this.projectionStates.get(projectionName);
        if (state.isRunning) {
            logger.warn('Projection is already running', { projectionName });
            return;
        }
        // Initialize last processed position
        state.lastProcessedPosition = await projection.getLastProcessedPosition();
        state.isRunning = true;
        state.errorCount = 0;
        // Start polling for events
        const interval = setInterval(async () => {
            await this.processEvents(projectionName);
        }, this.config.pollingIntervalMs);
        this.pollingIntervals.set(projectionName, interval);
        logger.info('Projection started', {
            projectionName,
            lastProcessedPosition: state.lastProcessedPosition
        });
        // Process initial batch
        await this.processEvents(projectionName);
    }
    /**
     * Stop all projections
     */
    async stopAll() {
        logger.info('Stopping all projections');
        for (const projectionName of this.projections.keys()) {
            await this.stop(projectionName);
        }
    }
    /**
     * Stop a specific projection
     */
    async stop(projectionName) {
        const state = this.projectionStates.get(projectionName);
        if (!state || !state.isRunning) {
            return;
        }
        const interval = this.pollingIntervals.get(projectionName);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(projectionName);
        }
        state.isRunning = false;
        logger.info('Projection stopped', { projectionName });
    }
    /**
     * Get projection states
     */
    getProjectionStates() {
        return Array.from(this.projectionStates.values());
    }
    /**
     * Get specific projection state
     */
    getProjectionState(projectionName) {
        return this.projectionStates.get(projectionName);
    }
    /**
     * Reset projection to beginning
     */
    async resetProjection(projectionName) {
        const projection = this.projections.get(projectionName);
        const state = this.projectionStates.get(projectionName);
        if (!projection || !state) {
            throw new Error(`Projection '${projectionName}' not found`);
        }
        const wasRunning = state.isRunning;
        if (wasRunning) {
            await this.stop(projectionName);
        }
        await projection.setLastProcessedPosition(0);
        state.lastProcessedPosition = 0;
        state.errorCount = 0;
        state.lastError = undefined;
        state.lastErrorAt = undefined;
        if (wasRunning) {
            await this.start(projectionName);
        }
        logger.info('Projection reset', { projectionName });
    }
    /**
     * Process events for a projection
     */
    async processEvents(projectionName) {
        const projection = this.projections.get(projectionName);
        const state = this.projectionStates.get(projectionName);
        if (!state.isRunning) {
            return;
        }
        try {
            // Get events from the last processed position
            const events = await this.eventStore.getGlobalEvents({
                fromPosition: state.lastProcessedPosition,
                limit: this.config.batchSize,
                eventTypes: projection.eventTypes
            });
            if (events.length === 0) {
                return; // No new events
            }
            logger.debug('Processing events for projection', {
                projectionName,
                eventCount: events.length,
                fromPosition: state.lastProcessedPosition
            });
            // Process events sequentially to maintain order
            for (const event of events) {
                await projection.handle(event);
                // Update position after each event to ensure consistency
                const eventPosition = event.globalPosition || state.lastProcessedPosition + 1;
                state.lastProcessedPosition = eventPosition;
                await projection.setLastProcessedPosition(eventPosition);
            }
            state.lastProcessedAt = new Date();
            state.errorCount = 0; // Reset error count on success
            logger.debug('Events processed successfully', {
                projectionName,
                eventsProcessed: events.length,
                newPosition: state.lastProcessedPosition
            });
        }
        catch (error) {
            state.errorCount++;
            state.lastError = error instanceof Error ? error.message : String(error);
            state.lastErrorAt = new Date();
            logger.error('Error processing events for projection', {
                projectionName,
                error: state.lastError,
                errorCount: state.errorCount,
                position: state.lastProcessedPosition
            });
            // Stop projection if too many errors
            if (state.errorCount >= this.config.maxRetries) {
                logger.error('Projection stopped due to too many errors', {
                    projectionName,
                    errorCount: state.errorCount,
                    maxRetries: this.config.maxRetries
                });
                await this.stop(projectionName);
            }
            else {
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * state.errorCount));
            }
        }
    }
}

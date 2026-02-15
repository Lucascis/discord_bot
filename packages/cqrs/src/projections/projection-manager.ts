import type { DomainEvent, IEventStore } from '@discord-bot/event-store';
import { logger } from '@discord-bot/logger';

const serializeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : error;

/**
 * Projection Interface
 * Defines contract for read model projections
 */
export interface IProjection {
  readonly projectionName: string;
  readonly eventTypes: string[];
  handle(event: DomainEvent): Promise<void>;
  getLastProcessedPosition(): Promise<number>;
  setLastProcessedPosition(position: number): Promise<void>;
}

/**
 * Projection State
 * Tracks projection processing state
 */
export interface ProjectionState {
  projectionName: string;
  lastProcessedPosition: number;
  lastProcessedAt: Date;
  isRunning: boolean;
  errorCount: number;
  lastError?: string;
  lastErrorAt?: Date;
}

/**
 * Projection Manager
 * Manages and coordinates projection processing
 */
export class ProjectionManager {
  private readonly eventStore: IEventStore;
  private readonly projections = new Map<string, IProjection>();
  private readonly projectionStates = new Map<string, ProjectionState>();
  private readonly pollingIntervals = new Map<string, NodeJS.Timeout>();

  private readonly config = {
    pollingIntervalMs: 5000,
    batchSize: 100,
    maxRetries: 3,
    retryDelayMs: 1000
  };

  constructor(eventStore: IEventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Register a projection
   */
  registerProjection(projection: IProjection): void {
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

    logger.info({
      projectionName: projection.projectionName,
      eventTypes: projection.eventTypes
    }, 'Projection registered');
  }

  /**
   * Start all projections
   */
  async startAll(): Promise<void> {
    logger.info({
      projectionCount: this.projections.size
    }, 'Starting all projections');

    for (const [name, _projection] of this.projections) {
      await this.start(name);
    }
  }

  /**
   * Start a specific projection
   */
  async start(projectionName: string): Promise<void> {
    const projection = this.projections.get(projectionName);
    if (!projection) {
      throw new Error(`Projection '${projectionName}' not found`);
    }

    const state = this.projectionStates.get(projectionName)!;
    if (state.isRunning) {
      logger.warn({ projectionName }, 'Projection is already running');
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

    logger.info({
      projectionName,
      lastProcessedPosition: state.lastProcessedPosition
    }, 'Projection started');

    // Process initial batch
    await this.processEvents(projectionName);
  }

  /**
   * Stop all projections
   */
  async stopAll(): Promise<void> {
    logger.info('Stopping all projections');

    for (const projectionName of this.projections.keys()) {
      await this.stop(projectionName);
    }
  }

  /**
   * Stop a specific projection
   */
  async stop(projectionName: string): Promise<void> {
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

    logger.info({ projectionName }, 'Projection stopped');
  }

  /**
   * Get projection states
   */
  getProjectionStates(): ProjectionState[] {
    return Array.from(this.projectionStates.values());
  }

  /**
   * Get specific projection state
   */
  getProjectionState(projectionName: string): ProjectionState | undefined {
    return this.projectionStates.get(projectionName);
  }

  /**
   * Reset projection to beginning
   */
  async resetProjection(projectionName: string): Promise<void> {
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

    logger.info({ projectionName }, 'Projection reset');
  }

  /**
   * Process events for a projection
   */
  private async processEvents(projectionName: string): Promise<void> {
    const projection = this.projections.get(projectionName)!;
    const state = this.projectionStates.get(projectionName)!;

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

      logger.debug({
        projectionName,
        eventCount: events.length,
        fromPosition: state.lastProcessedPosition
      }, 'Processing events for projection');

      // Process events sequentially to maintain order
      for (const event of events) {
        await projection.handle(event);

        // Update position after each event to ensure consistency
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventPosition = (event as any).globalPosition || state.lastProcessedPosition + 1;
        state.lastProcessedPosition = eventPosition;
        await projection.setLastProcessedPosition(eventPosition);
      }

      state.lastProcessedAt = new Date();
      state.errorCount = 0; // Reset error count on success

      logger.debug({
        projectionName,
        eventsProcessed: events.length,
        newPosition: state.lastProcessedPosition
      }, 'Events processed successfully');

    } catch (error) {
      state.errorCount++;
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastErrorAt = new Date();

      logger.error({
        projectionName,
        error: serializeError(error),
        errorCount: state.errorCount,
        position: state.lastProcessedPosition
      }, 'Error processing events for projection');

      // Stop projection if too many errors
      if (state.errorCount >= this.config.maxRetries) {
        logger.error({
          projectionName,
          errorCount: state.errorCount,
          maxRetries: this.config.maxRetries
        }, 'Projection stopped due to too many errors');
        await this.stop(projectionName);
      } else {
        // Wait before retrying
        await new Promise(resolve =>
          setTimeout(resolve, this.config.retryDelayMs * state.errorCount)
        );
      }
    }
  }
}

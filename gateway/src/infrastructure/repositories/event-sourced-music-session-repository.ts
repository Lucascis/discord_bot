import { EventSourcedRepository } from '@discord-bot/event-store';
import type { IEventStore } from '@discord-bot/event-store';
import { EventSourcedMusicSession } from '../../domain/aggregates/event-sourced-music-session.js';

/**
 * Event Sourced Music Session Repository
 * Handles persistence and retrieval of music sessions using event sourcing
 */
export class EventSourcedMusicSessionRepository extends EventSourcedRepository<EventSourcedMusicSession> {

  constructor(eventStore: IEventStore) {
    super(eventStore);
  }

  protected createFromSnapshot(aggregateId: string, snapshotData: Record<string, unknown>): EventSourcedMusicSession {
    return EventSourcedMusicSession.fromSnapshot(aggregateId, snapshotData);
  }

  protected createEmpty(aggregateId: string): EventSourcedMusicSession {
    return EventSourcedMusicSession.create(aggregateId);
  }

  protected getAggregateType(): string {
    return 'MusicSession';
  }

  /**
   * Create a new session and save it
   */
  async createNew(guildId: string): Promise<EventSourcedMusicSession> {
    const session = EventSourcedMusicSession.create(guildId);
    await this.save(session);
    return session;
  }

  /**
   * Load session by guild ID
   */
  async loadByGuildId(guildId: string): Promise<EventSourcedMusicSession | null> {
    return await this.load(guildId);
  }

  /**
   * Get or create session for a guild
   */
  async getOrCreate(guildId: string): Promise<EventSourcedMusicSession> {
    let session = await this.loadByGuildId(guildId);

    if (!session) {
      session = await this.createNew(guildId);
    }

    return session;
  }

  /**
   * Save session snapshot for performance optimization
   */
  async saveSnapshot(session: EventSourcedMusicSession): Promise<void> {
    const snapshot = {
      aggregateId: session.aggregateId,
      aggregateType: this.getAggregateType(),
      version: session.version,
      data: session.toSnapshot(),
      timestamp: new Date()
    };

    await this.eventStore.saveSnapshot(snapshot);
  }
}
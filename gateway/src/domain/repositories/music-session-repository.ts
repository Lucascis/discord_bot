import { MusicSession } from '../entities/music-session.js';
import { GuildId } from '../value-objects/guild-id.js';

/**
 * Music Session Repository Interface
 * Defines contract for persisting music sessions
 */
export interface MusicSessionRepository {
  /**
   * Find music session by guild ID
   */
  findByGuildId(guildId: GuildId): Promise<MusicSession | null>;

  /**
   * Save music session
   */
  save(session: MusicSession): Promise<void>;

  /**
   * Delete music session
   */
  delete(guildId: GuildId): Promise<void>;

  /**
   * Find all active sessions
   */
  findAllActive(): Promise<MusicSession[]>;

  /**
   * Find sessions that have been idle for a specified duration
   */
  findIdleSessions(idleDurationMs: number): Promise<MusicSession[]>;

  /**
   * Update session state only
   */
  updateState(guildId: GuildId, state: 'idle' | 'playing' | 'paused' | 'stopped'): Promise<void>;

  /**
   * Update position for a session
   */
  updatePosition(guildId: GuildId, position: number): Promise<void>;

  /**
   * Bulk cleanup idle sessions
   */
  cleanupIdleSessions(idleDurationMs: number): Promise<number>;
}
import { Redis } from 'ioredis';
import { MusicSession } from '../../domain/entities/music-session.js';
import { MusicSessionRepository } from '../../domain/repositories/music-session-repository.js';
import { GuildId } from '../../domain/value-objects/guild-id.js';

/**
 * Redis implementation of MusicSessionRepository
 * Stores music sessions in Redis for fast access and automatic expiration
 */
export class RedisMusicSessionRepository implements MusicSessionRepository {
  private readonly keyPrefix = 'music_session:';
  private readonly sessionTTL = 3600; // 1 hour TTL

  constructor(private readonly redis: Redis) {}

  async findByGuildId(guildId: GuildId): Promise<MusicSession | null> {
    try {
      const key = this.getKey(guildId.value);
      const data = await this.redis.get(key);

      if (!data) {
        return null;
      }

      const sessionData = JSON.parse(data);

      // Convert ISO strings back to Dates
      if (sessionData.lastUpdated) {
        sessionData.lastUpdated = new Date(sessionData.lastUpdated);
      }

      return MusicSession.fromData(sessionData);

    } catch (error) {
      throw new Error(`Failed to find music session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async save(session: MusicSession): Promise<void> {
    try {
      const key = this.getKey(session.guildId.value);
      const data = JSON.stringify(session.toData());

      await this.redis.setex(key, this.sessionTTL, data);

    } catch (error) {
      throw new Error(`Failed to save music session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async delete(guildId: GuildId): Promise<void> {
    try {
      const key = this.getKey(guildId.value);
      await this.redis.del(key);

    } catch (error) {
      throw new Error(`Failed to delete music session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findAllActive(): Promise<MusicSession[]> {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return [];
      }

      const pipeline = this.redis.pipeline();
      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();

      const sessions: MusicSession[] = [];

      if (results) {
        for (const result of results) {
          if (result && result[1]) {
            try {
              const sessionData = JSON.parse(result[1] as string);

              // Convert ISO strings back to Dates
              if (sessionData.lastUpdated) {
                sessionData.lastUpdated = new Date(sessionData.lastUpdated);
              }

              const session = MusicSession.fromData(sessionData);

              // Only include active sessions
              if (session.isActive) {
                sessions.push(session);
              }
            } catch {
              // Skip invalid session data
              continue;
            }
          }
        }
      }

      return sessions;

    } catch (error) {
      throw new Error(`Failed to find active sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findIdleSessions(idleDurationMs: number): Promise<MusicSession[]> {
    try {
      const allSessions = await this.findAllActive();
      const now = Date.now();

      return allSessions.filter(session => {
        const idleTime = now - session.lastUpdated.getTime();
        return idleTime > idleDurationMs;
      });

    } catch (error) {
      throw new Error(`Failed to find idle sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateState(guildId: GuildId, state: 'idle' | 'playing' | 'paused' | 'stopped'): Promise<void> {
    try {
      const session = await this.findByGuildId(guildId);
      if (!session) {
        return; // Session doesn't exist
      }

      // Update state based on type
      switch (state) {
        case 'idle':
          session.disconnect();
          break;
        case 'playing':
          if (session.isPaused) {
            session.resume();
          }
          break;
        case 'paused':
          if (session.state === 'playing') {
            session.pause();
          }
          break;
        case 'stopped':
          session.stop();
          break;
      }

      await this.save(session);

    } catch (error) {
      throw new Error(`Failed to update session state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updatePosition(guildId: GuildId, position: number): Promise<void> {
    try {
      const session = await this.findByGuildId(guildId);
      if (!session) {
        return; // Session doesn't exist
      }

      session.setPosition(position);
      await this.save(session);

    } catch (error) {
      throw new Error(`Failed to update session position: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async cleanupIdleSessions(idleDurationMs: number): Promise<number> {
    try {
      const idleSessions = await this.findIdleSessions(idleDurationMs);
      let cleanedCount = 0;

      for (const session of idleSessions) {
        await this.delete(session.guildId);
        cleanedCount++;
      }

      return cleanedCount;

    } catch (error) {
      throw new Error(`Failed to cleanup idle sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getKey(guildId: string): string {
    return `${this.keyPrefix}${guildId}`;
  }
}
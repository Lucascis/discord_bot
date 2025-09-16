import { MusicSession } from '../entities/music-session.js';
import { GuildSettings } from '../entities/guild-settings.js';
import { GuildId } from '../value-objects/guild-id.js';
import { UserId } from '../value-objects/user-id.js';

/**
 * Music Session Domain Service
 * Contains domain logic that doesn't naturally fit in entities
 */
export class MusicSessionDomainService {

  /**
   * Determines if a user can control music in a guild
   */
  canUserControlMusic(
    userId: UserId,
    guildSettings: GuildSettings,
    userRoles: string[],
    isUserInVoiceChannel: boolean,
    isUserAloneInChannel: boolean
  ): boolean {
    // User must be in voice channel to control music
    if (!isUserInVoiceChannel) {
      return false;
    }

    // If user is alone in voice channel, they can always control
    if (isUserAloneInChannel) {
      return true;
    }

    // Check if DJ role is required
    if (guildSettings.djRoleName) {
      return userRoles.includes(guildSettings.djRoleName);
    }

    // Default: anyone in voice channel can control
    return true;
  }

  /**
   * Determines if a session should auto-disconnect due to inactivity
   */
  shouldAutoDisconnect(
    session: MusicSession,
    maxIdleTimeMs: number = 300000 // 5 minutes default
  ): boolean {
    if (!session.isActive) {
      return false;
    }

    const idleTime = Date.now() - session.lastUpdated.getTime();
    return idleTime > maxIdleTimeMs;
  }

  /**
   * Calculates the recommended volume based on time of day and guild settings
   */
  calculateRecommendedVolume(
    guildSettings: GuildSettings,
    currentHour: number = new Date().getHours()
  ): number {
    const baseVolume = guildSettings.defaultVolume;

    // Reduce volume during night hours (22:00 - 06:00)
    if (currentHour >= 22 || currentHour <= 6) {
      return Math.max(30, Math.floor(baseVolume * 0.7));
    }

    return baseVolume;
  }

  /**
   * Validates if a session state transition is allowed
   */
  isValidStateTransition(
    currentState: MusicSession['state'],
    newState: MusicSession['state']
  ): boolean {
    const validTransitions: Record<string, string[]> = {
      'idle': ['playing'],
      'playing': ['paused', 'stopped', 'idle'],
      'paused': ['playing', 'stopped', 'idle'],
      'stopped': ['playing', 'idle']
    };

    return validTransitions[currentState]?.includes(newState) ?? false;
  }

  /**
   * Determines if automix should be triggered
   */
  shouldTriggerAutomix(
    session: MusicSession,
    guildSettings: GuildSettings,
    queueRemainingTracks: number
  ): boolean {
    if (!guildSettings.automixEnabled) {
      return false;
    }

    if (!session.isActive) {
      return false;
    }

    // Trigger automix when queue has 2 or fewer tracks remaining
    return queueRemainingTracks <= 2;
  }

  /**
   * Calculates session statistics
   */
  calculateSessionStats(session: MusicSession): {
    uptimeMs: number;
    isLongRunning: boolean;
    estimatedIdleTime: number;
  } {
    const now = Date.now();
    const uptimeMs = session.isActive ? now - session.lastUpdated.getTime() : 0;
    const isLongRunning = uptimeMs > 3600000; // 1 hour

    let estimatedIdleTime = 0;
    if (session.state === 'paused') {
      estimatedIdleTime = now - session.lastUpdated.getTime();
    }

    return {
      uptimeMs,
      isLongRunning,
      estimatedIdleTime
    };
  }

  /**
   * Determines optimal queue size based on guild activity
   */
  calculateOptimalQueueSize(
    guildSettings: GuildSettings,
    activeUsersCount: number,
    averageSessionDuration: number
  ): number {
    const baseSize = Math.min(guildSettings.maxQueueSize, 50);

    // Increase queue size for more active guilds
    const activityMultiplier = Math.min(2, 1 + (activeUsersCount / 10));

    // Adjust based on average session duration
    const durationMultiplier = averageSessionDuration > 3600000 ? 1.5 : 1;

    return Math.floor(baseSize * activityMultiplier * durationMultiplier);
  }
}
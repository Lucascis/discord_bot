import { logger } from '@discord-bot/logger';
import { DiscordPermissionService } from '../infrastructure/discord/discord-permission-service.js';
import { SettingsService } from './settings-service.js';

export interface VoteSkipSession {
  guildId: string;
  channelId: string;
  initiatedBy: string;
  votes: Set<string>; // User IDs who voted
  requiredVotes: number;
  threshold: number;
  startTime: number;
  timeout?: NodeJS.Timeout;
}

/**
 * Vote Skip Service
 * Manages vote skip sessions and voting logic
 */
export class VoteSkipService {
  private activeVotes: Map<string, VoteSkipSession> = new Map(); // guildId -> VoteSkipSession

  constructor(
    private readonly permissionService: DiscordPermissionService,
    private readonly settingsService: SettingsService
  ) {}

  /**
   * Initiate a vote skip session
   */
  async initiateVoteSkip(
    guildId: string,
    channelId: string,
    userId: string
  ): Promise<{
    success: boolean;
    message: string;
    session?: VoteSkipSession;
  }> {
    try {
      // Check if vote skip is enabled for this guild
      const settings = await this.settingsService.getGuildSettings(guildId);
      if (!settings.voteSkipEnabled) {
        return {
          success: false,
          message: '🚫 Vote skip is disabled for this server.'
        };
      }

      // Check if there's already an active vote
      const existingSession = this.activeVotes.get(guildId);
      if (existingSession) {
        return {
          success: false,
          message: '⚡ A vote skip is already in progress! Use `/voteskip` to vote.'
        };
      }

      // Get voice channel member count to calculate required votes
      const userVoiceChannelId = await this.permissionService.getUserVoiceChannelId(userId, guildId);
      if (!userVoiceChannelId) {
        return {
          success: false,
          message: '🚫 You must be in a voice channel to start a vote skip.'
        };
      }

      const voiceChannelMemberCount = await this.permissionService.getVoiceChannelMemberCount(
        guildId,
        userVoiceChannelId
      );

      if (voiceChannelMemberCount < 2) {
        return {
          success: false,
          message: '🚫 You need at least 2 people in the voice channel to start a vote skip.'
        };
      }

      // Calculate required votes based on threshold
      const requiredVotes = Math.ceil(voiceChannelMemberCount * settings.voteSkipThreshold);

      // Create vote session
      const session: VoteSkipSession = {
        guildId,
        channelId,
        initiatedBy: userId,
        votes: new Set([userId]), // Initiator automatically votes
        requiredVotes,
        threshold: settings.voteSkipThreshold,
        startTime: Date.now()
      };

      // Set timeout to auto-expire vote after 60 seconds
      session.timeout = setTimeout(() => {
        this.expireVoteSession(guildId);
      }, 60000);

      this.activeVotes.set(guildId, session);

      logger.info({
        guildId,
        userId,
        voiceChannelMemberCount,
        requiredVotes,
        threshold: settings.voteSkipThreshold
      }, 'Vote skip session initiated');

      return {
        success: true,
        message: `🗳️ Vote skip started! **${session.votes.size}/${requiredVotes}** votes (${Math.round(settings.voteSkipThreshold * 100)}% needed)`,
        session
      };

    } catch (error) {
      logger.error({ error, guildId, userId }, 'Failed to initiate vote skip');
      return {
        success: false,
        message: '❌ Failed to start vote skip. Please try again.'
      };
    }
  }

  /**
   * Cast a vote in an active vote skip session
   */
  async castVote(
    guildId: string,
    userId: string
  ): Promise<{
    success: boolean;
    message: string;
    completed?: boolean;
    session?: VoteSkipSession;
  }> {
    try {
      const session = this.activeVotes.get(guildId);
      if (!session) {
        return {
          success: false,
          message: '❌ No active vote skip session. Start one with `/voteskip`.'
        };
      }

      // Check if user is in the same voice channel as the initiator
      const userVoiceChannelId = await this.permissionService.getUserVoiceChannelId(userId, guildId);
      const initiatorVoiceChannelId = await this.permissionService.getUserVoiceChannelId(
        session.initiatedBy,
        guildId
      );

      if (!userVoiceChannelId || userVoiceChannelId !== initiatorVoiceChannelId) {
        return {
          success: false,
          message: '🚫 You must be in the same voice channel to vote.'
        };
      }

      // Check if user already voted
      if (session.votes.has(userId)) {
        return {
          success: false,
          message: '✅ You have already voted to skip this track.'
        };
      }

      // Add vote
      session.votes.add(userId);

      logger.info({
        guildId,
        userId,
        voteCount: session.votes.size,
        requiredVotes: session.requiredVotes
      }, 'Vote cast in skip session');

      // Check if threshold is met
      if (session.votes.size >= session.requiredVotes) {
        this.expireVoteSession(guildId);
        return {
          success: true,
          message: `✅ Vote skip passed! **${session.votes.size}/${session.requiredVotes}** votes reached.`,
          completed: true,
          session
        };
      }

      return {
        success: true,
        message: `🗳️ Vote recorded! **${session.votes.size}/${session.requiredVotes}** votes`,
        completed: false,
        session
      };

    } catch (error) {
      logger.error({ error, guildId, userId }, 'Failed to cast vote');
      return {
        success: false,
        message: '❌ Failed to cast vote. Please try again.'
      };
    }
  }

  /**
   * Get current vote skip session for a guild
   */
  getActiveSession(guildId: string): VoteSkipSession | null {
    return this.activeVotes.get(guildId) || null;
  }

  /**
   * Cancel an active vote skip session
   */
  cancelVoteSession(guildId: string): boolean {
    const session = this.activeVotes.get(guildId);
    if (!session) {
      return false;
    }

    if (session.timeout) {
      clearTimeout(session.timeout);
    }

    this.activeVotes.delete(guildId);

    logger.info({ guildId }, 'Vote skip session cancelled');
    return true;
  }

  /**
   * Expire a vote skip session (called by timeout or completion)
   */
  private expireVoteSession(guildId: string): void {
    const session = this.activeVotes.get(guildId);
    if (!session) {
      return;
    }

    if (session.timeout) {
      clearTimeout(session.timeout);
    }

    this.activeVotes.delete(guildId);

    logger.info({
      guildId,
      voteCount: session.votes.size,
      requiredVotes: session.requiredVotes,
      duration: Date.now() - session.startTime
    }, 'Vote skip session expired');
  }

  /**
   * Clean up expired sessions (called periodically)
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [guildId, session] of this.activeVotes.entries()) {
      // Sessions expire after 60 seconds
      if (now - session.startTime > 60000) {
        expiredSessions.push(guildId);
      }
    }

    for (const guildId of expiredSessions) {
      this.expireVoteSession(guildId);
    }

    if (expiredSessions.length > 0) {
      logger.info({
        expiredCount: expiredSessions.length,
        activeCount: this.activeVotes.size
      }, 'Cleaned up expired vote skip sessions');
    }
  }
}
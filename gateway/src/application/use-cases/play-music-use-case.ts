import { PlayMusicCommand } from '../commands/play-music-command.js';
import { MusicSessionRepository } from '../../domain/repositories/music-session-repository.js';
import { GuildSettingsRepository } from '../../domain/repositories/guild-settings-repository.js';
import { MusicSessionDomainService } from '../../domain/services/music-session-domain-service.js';
import { MusicSession } from '../../domain/entities/music-session.js';
import { GuildSettings } from '../../domain/entities/guild-settings.js';
import {
  MusicSessionStartedEvent,
  SearchRequestedEvent,
  SearchCompletedEvent
} from '../../domain/events/domain-event.js';
import type { DomainEvent } from '@discord-bot/event-store';
import { GuildId } from '../../domain/value-objects/guild-id.js';

/**
 * Play Music Use Case Result
 */
export interface PlayMusicResult {
  success: boolean;
  message: string;
  trackTitle?: string;
  queuePosition?: number;
  events: DomainEvent[]; // Domain events to be published
}

/**
 * Audio Service Interface (Port)
 * Defines contract for audio operations
 */
export interface AudioService {
  searchTrack(query: string, guildId: string): Promise<{
    tracks: Array<{ title: string; uri: string; duration: number }>;
    source: 'youtube' | 'spotify' | 'other';
    latency: number;
    cached: boolean;
  }>;

  playTrack(guildId: string, trackUri: string, voiceChannelId: string): Promise<{
    success: boolean;
    message: string;
    queuePosition?: number;
  }>;

  isConnectedToVoice(guildId: string): Promise<boolean>;
  connectToVoice(guildId: string, voiceChannelId: string): Promise<void>;
}

/**
 * Permission Service Interface (Port)
 */
export interface PermissionService {
  hasPermissionToControlMusic(
    userId: string,
    guildId: string,
    userRoles: string[],
    djRoleName: string | null
  ): Promise<boolean>;

  isUserInVoiceChannel(userId: string, guildId: string): Promise<boolean>;
  isUserAloneInVoiceChannel(userId: string, guildId: string): Promise<boolean>;
}

/**
 * Play Music Use Case
 * Handles the business logic for playing music
 */
export class PlayMusicUseCase {
  constructor(
    private readonly musicSessionRepository: MusicSessionRepository,
    private readonly guildSettingsRepository: GuildSettingsRepository,
    private readonly musicSessionDomainService: MusicSessionDomainService,
    private readonly audioService: AudioService,
    private readonly permissionService: PermissionService
  ) {}

  async execute(command: PlayMusicCommand): Promise<PlayMusicResult> {
    const events: DomainEvent[] = [];

    try {
      // 1. Validate user permissions
      const [guildSettings, session] = await Promise.all([
        this.getOrCreateGuildSettings(command.guildId),
        this.getOrCreateMusicSession(command.guildId)
      ]);

      // 2. Check if user can control music
      const canControl = this.musicSessionDomainService.canUserControlMusic(
        command.userId,
        guildSettings,
        command.userRoles,
        true, // We assume they're in voice channel since they triggered the command
        command.isUserAloneInChannel
      );

      if (!canControl) {
        return {
          success: false,
          message: 'You do not have permission to control music in this guild.',
          events
        };
      }

      // 3. Search for the track
      events.push(SearchRequestedEvent(
        command.guildId.value,
        command.query.value,
        command.userId.value,
        command.query.isYouTubeUrl ? 'youtube' :
        command.query.isSpotifyUrl ? 'spotify' : 'other'
      ));

      const searchResult = await this.audioService.searchTrack(
        command.query.value,
        command.guildId.value
      );

      events.push(SearchCompletedEvent(
        command.guildId.value,
        command.query.value,
        searchResult.tracks.length,
        searchResult.latency,
        command.userId.value,
        searchResult.cached
      ));

      if (searchResult.tracks.length === 0) {
        return {
          success: false,
          message: 'No tracks found for your search query.',
          events
        };
      }

      // 4. Connect to voice if not already connected
      const isConnected = await this.audioService.isConnectedToVoice(command.guildId.value);
      if (!isConnected) {
        await this.audioService.connectToVoice(command.guildId.value, command.voiceChannelId);
      }

      // 5. Play the track
      const selectedTrack = searchResult.tracks[0];
      const playResult = await this.audioService.playTrack(
        command.guildId.value,
        selectedTrack.uri,
        command.voiceChannelId
      );

      if (!playResult.success) {
        return {
          success: false,
          message: playResult.message,
          events
        };
      }

      // 6. Update session state
      if (!session.isActive) {
        session.startPlaying(
          selectedTrack.title,
          command.voiceChannelId,
          command.textChannelId
        );

        events.push(MusicSessionStartedEvent(
          command.guildId.value,
          selectedTrack.title,
          command.voiceChannelId,
          command.textChannelId,
          command.userId.value
        ));
      } else {
        session.addToQueue();
      }

      // 7. Save session
      await this.musicSessionRepository.save(session);

      return {
        success: true,
        message: session.isActive && playResult.queuePosition
          ? `Added **${selectedTrack.title}** to queue at position ${playResult.queuePosition}`
          : `Now playing **${selectedTrack.title}**`,
        trackTitle: selectedTrack.title,
        queuePosition: playResult.queuePosition,
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
        events
      };
    }
  }

  private async getOrCreateGuildSettings(guildId: GuildId): Promise<GuildSettings> {
    let settings = await this.guildSettingsRepository.findByGuildId(guildId);
    if (!settings) {
      settings = GuildSettings.create(guildId);
      await this.guildSettingsRepository.save(settings);
    }
    return settings;
  }

  private async getOrCreateMusicSession(guildId: GuildId): Promise<MusicSession> {
    let session = await this.musicSessionRepository.findByGuildId(guildId);
    if (!session) {
      session = MusicSession.create(guildId);
      await this.musicSessionRepository.save(session);
    }
    return session;
  }
}
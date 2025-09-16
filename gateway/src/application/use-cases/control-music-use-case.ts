import {
  PauseMusicCommand,
  ResumeMusicCommand,
  StopMusicCommand,
  SetVolumeCommand,
  SetLoopModeCommand
} from '../commands/play-music-command.js';
import { MusicSessionRepository } from '../../domain/repositories/music-session-repository.js';
import { GuildSettingsRepository } from '../../domain/repositories/guild-settings-repository.js';
import { MusicSessionDomainService } from '../../domain/services/music-session-domain-service.js';
import {
  MusicSessionPausedEvent,
  MusicSessionResumedEvent,
  MusicSessionStoppedEvent,
  VolumeChangedEvent,
  LoopModeChangedEvent
} from '../../domain/events/domain-event.js';

/**
 * Control Music Result
 */
export interface ControlMusicResult {
  success: boolean;
  message: string;
  events: any[]; // Domain events to be published
}

/**
 * Audio Control Service Interface (Port)
 */
export interface AudioControlService {
  pause(guildId: string): Promise<{ success: boolean; message: string }>;
  resume(guildId: string): Promise<{ success: boolean; message: string }>;
  stop(guildId: string): Promise<{ success: boolean; message: string }>;
  setVolume(guildId: string, volume: number): Promise<{ success: boolean; message: string }>;
  setLoopMode(guildId: string, mode: 'off' | 'track' | 'queue'): Promise<{ success: boolean; message: string }>;
  disconnect(guildId: string): Promise<void>;
}

/**
 * Control Music Use Cases
 * Handles pause, resume, stop, volume, and loop mode operations
 */
export class ControlMusicUseCase {
  constructor(
    private readonly musicSessionRepository: MusicSessionRepository,
    private readonly guildSettingsRepository: GuildSettingsRepository,
    private readonly musicSessionDomainService: MusicSessionDomainService,
    private readonly audioControlService: AudioControlService
  ) {}

  async pauseMusic(command: PauseMusicCommand): Promise<ControlMusicResult> {
    const events: any[] = [];

    try {
      const [guildSettings, session] = await Promise.all([
        this.guildSettingsRepository.findByGuildId(command.guildId),
        this.musicSessionRepository.findByGuildId(command.guildId)
      ]);

      if (!session || !session.isActive) {
        return {
          success: false,
          message: 'No music is currently playing.',
          events
        };
      }

      if (session.isPaused) {
        return {
          success: false,
          message: 'Music is already paused.',
          events
        };
      }

      // Check permissions (if guild settings exist)
      if (guildSettings) {
        const canControl = this.musicSessionDomainService.canUserControlMusic(
          command.userId,
          guildSettings,
          command.userRoles,
          true, // Assume user is in voice channel
          false // We don't have this info for pause command
        );

        if (!canControl) {
          return {
            success: false,
            message: 'You do not have permission to control music.',
            events
          };
        }
      }

      // Pause the audio
      const result = await this.audioControlService.pause(command.guildId.value);
      if (!result.success) {
        return {
          success: false,
          message: result.message,
          events
        };
      }

      // Update session
      session.pause();
      await this.musicSessionRepository.save(session);

      events.push(new MusicSessionPausedEvent(
        command.guildId.value,
        command.userId.value,
        session.position
      ));

      return {
        success: true,
        message: 'Music paused.',
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to pause music',
        events
      };
    }
  }

  async resumeMusic(command: ResumeMusicCommand): Promise<ControlMusicResult> {
    const events: any[] = [];

    try {
      const [guildSettings, session] = await Promise.all([
        this.guildSettingsRepository.findByGuildId(command.guildId),
        this.musicSessionRepository.findByGuildId(command.guildId)
      ]);

      if (!session || !session.isActive) {
        return {
          success: false,
          message: 'No music session found.',
          events
        };
      }

      if (!session.isPaused) {
        return {
          success: false,
          message: 'Music is not paused.',
          events
        };
      }

      // Check permissions
      if (guildSettings) {
        const canControl = this.musicSessionDomainService.canUserControlMusic(
          command.userId,
          guildSettings,
          command.userRoles,
          true,
          false
        );

        if (!canControl) {
          return {
            success: false,
            message: 'You do not have permission to control music.',
            events
          };
        }
      }

      // Resume the audio
      const result = await this.audioControlService.resume(command.guildId.value);
      if (!result.success) {
        return {
          success: false,
          message: result.message,
          events
        };
      }

      // Update session
      session.resume();
      await this.musicSessionRepository.save(session);

      events.push(new MusicSessionResumedEvent(
        command.guildId.value,
        command.userId.value,
        session.position
      ));

      return {
        success: true,
        message: 'Music resumed.',
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to resume music',
        events
      };
    }
  }

  async stopMusic(command: StopMusicCommand): Promise<ControlMusicResult> {
    const events: any[] = [];

    try {
      const [guildSettings, session] = await Promise.all([
        this.guildSettingsRepository.findByGuildId(command.guildId),
        this.musicSessionRepository.findByGuildId(command.guildId)
      ]);

      if (!session || !session.isActive) {
        return {
          success: false,
          message: 'No music is currently playing.',
          events
        };
      }

      // Check permissions (but allow stop for errors/timeouts)
      if (command.reason === 'user_requested' && guildSettings) {
        const canControl = this.musicSessionDomainService.canUserControlMusic(
          command.userId,
          guildSettings,
          command.userRoles,
          true,
          false
        );

        if (!canControl) {
          return {
            success: false,
            message: 'You do not have permission to control music.',
            events
          };
        }
      }

      // Stop the audio
      const result = await this.audioControlService.stop(command.guildId.value);
      if (!result.success && command.reason === 'user_requested') {
        return {
          success: false,
          message: result.message,
          events
        };
      }

      // Disconnect if requested or if error/timeout
      if (command.reason !== 'user_requested') {
        await this.audioControlService.disconnect(command.guildId.value);
        session.disconnect();
      } else {
        session.stop();
      }

      await this.musicSessionRepository.save(session);

      // Map timeout to queue_ended for the event
      const eventReason = command.reason === 'timeout' ? 'queue_ended' :
                          command.reason as 'user_requested' | 'error' | 'queue_ended';

      events.push(new MusicSessionStoppedEvent(
        command.guildId.value,
        command.userId.value,
        eventReason
      ));

      return {
        success: true,
        message: command.reason === 'user_requested' ? 'Music stopped.' : 'Session ended.',
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to stop music',
        events
      };
    }
  }

  async setVolume(command: SetVolumeCommand): Promise<ControlMusicResult> {
    const events: any[] = [];

    try {
      const [guildSettings, session] = await Promise.all([
        this.guildSettingsRepository.findByGuildId(command.guildId),
        this.musicSessionRepository.findByGuildId(command.guildId)
      ]);

      if (!session || !session.isActive) {
        return {
          success: false,
          message: 'No music is currently playing.',
          events
        };
      }

      // Check permissions
      if (guildSettings) {
        const canControl = this.musicSessionDomainService.canUserControlMusic(
          command.userId,
          guildSettings,
          command.userRoles,
          true,
          false
        );

        if (!canControl) {
          return {
            success: false,
            message: 'You do not have permission to control music.',
            events
          };
        }
      }

      const oldVolume = session.volume;

      // Set volume in audio service
      const result = await this.audioControlService.setVolume(command.guildId.value, command.volume);
      if (!result.success) {
        return {
          success: false,
          message: result.message,
          events
        };
      }

      // Update session
      session.setVolume(command.volume);
      await this.musicSessionRepository.save(session);

      events.push(new VolumeChangedEvent(
        command.guildId.value,
        oldVolume,
        command.volume,
        command.userId.value
      ));

      return {
        success: true,
        message: `Volume set to ${command.volume}%.`,
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set volume',
        events
      };
    }
  }

  async setLoopMode(command: SetLoopModeCommand): Promise<ControlMusicResult> {
    const events: any[] = [];

    try {
      const [guildSettings, session] = await Promise.all([
        this.guildSettingsRepository.findByGuildId(command.guildId),
        this.musicSessionRepository.findByGuildId(command.guildId)
      ]);

      if (!session) {
        return {
          success: false,
          message: 'No music session found.',
          events
        };
      }

      // Check permissions
      if (guildSettings) {
        const canControl = this.musicSessionDomainService.canUserControlMusic(
          command.userId,
          guildSettings,
          command.userRoles,
          true,
          false
        );

        if (!canControl) {
          return {
            success: false,
            message: 'You do not have permission to control music.',
            events
          };
        }
      }

      const oldMode = session.loopMode;

      // Set loop mode in audio service
      const result = await this.audioControlService.setLoopMode(command.guildId.value, command.loopMode);
      if (!result.success) {
        return {
          success: false,
          message: result.message,
          events
        };
      }

      // Update session
      session.setLoopMode(command.loopMode);
      await this.musicSessionRepository.save(session);

      events.push(new LoopModeChangedEvent(
        command.guildId.value,
        oldMode,
        command.loopMode,
        command.userId.value
      ));

      const modeText = {
        'off': 'disabled',
        'track': 'current track',
        'queue': 'entire queue'
      }[command.loopMode];

      return {
        success: true,
        message: `Loop mode set to ${modeText}.`,
        events
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set loop mode',
        events
      };
    }
  }
}
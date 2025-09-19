import { BaseCommand } from '@discord-bot/cqrs';

/**
 * Start Playing Music Command
 */
export class StartPlayingMusicCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    public readonly query: string,
    public readonly voiceChannelId: string,
    public readonly textChannelId: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('StartPlayingMusic', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Pause Music Command
 */
export class PauseMusicCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('PauseMusic', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Resume Music Command
 */
export class ResumeMusicCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('ResumeMusic', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Stop Music Command
 */
export class StopMusicCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('StopMusic', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Change Volume Command
 */
export class ChangeVolumeCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    public readonly volume: number,
    metadata: Record<string, unknown> = {}
  ) {
    super('ChangeVolume', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Add Track to Queue Command
 */
export class AddTrackToQueueCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    public readonly query: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('AddTrackToQueue', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Skip Track Command
 */
export class SkipTrackCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    metadata: Record<string, unknown> = {}
  ) {
    super('SkipTrack', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Set Loop Mode Command
 */
export class SetLoopModeCommand extends BaseCommand {
  constructor(
    public readonly guildId: string,
    public readonly userId: string,
    public readonly loopMode: 'off' | 'track' | 'queue',
    metadata: Record<string, unknown> = {}
  ) {
    super('SetLoopMode', {
      userId,
      guildId,
      ...metadata
    });
  }
}
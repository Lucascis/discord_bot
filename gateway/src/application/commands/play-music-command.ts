import { GuildId } from '../../domain/value-objects/guild-id.js';
import { UserId } from '../../domain/value-objects/user-id.js';
import { SearchQuery } from '../../domain/value-objects/search-query.js';

/**
 * Play Music Command
 * Represents a request to play music in a guild
 */
export class PlayMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly query: SearchQuery,
    public readonly voiceChannelId: string,
    public readonly textChannelId: string,
    public readonly userRoles: string[] = [],
    public readonly isUserAloneInChannel: boolean = false,
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    query: string;
    voiceChannelId: string;
    textChannelId: string;
    userRoles?: string[];
    isUserAloneInChannel?: boolean;
  }): PlayMusicCommand {
    return new PlayMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      SearchQuery.from(data.query),
      data.voiceChannelId,
      data.textChannelId,
      data.userRoles ?? [],
      data.isUserAloneInChannel ?? false
    );
  }
}

/**
 * Play Next Music Command
 * Adds track to the beginning of the queue
 */
export class PlayNextMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly query: SearchQuery,
    public readonly voiceChannelId: string,
    public readonly textChannelId: string,
    public readonly userRoles: string[] = [],
    public readonly isUserAloneInChannel: boolean = false,
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    query: string;
    voiceChannelId: string;
    textChannelId: string;
    userRoles?: string[];
    isUserAloneInChannel?: boolean;
  }): PlayNextMusicCommand {
    return new PlayNextMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      SearchQuery.from(data.query),
      data.voiceChannelId,
      data.textChannelId,
      data.userRoles ?? [],
      data.isUserAloneInChannel ?? false
    );
  }
}

/**
 * Play Now Music Command
 * Interrupts current track and plays immediately
 */
export class PlayNowMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly query: SearchQuery,
    public readonly voiceChannelId: string,
    public readonly textChannelId: string,
    public readonly userRoles: string[] = [],
    public readonly isUserAloneInChannel: boolean = false,
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    query: string;
    voiceChannelId: string;
    textChannelId: string;
    userRoles?: string[];
    isUserAloneInChannel?: boolean;
  }): PlayNowMusicCommand {
    return new PlayNowMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      SearchQuery.from(data.query),
      data.voiceChannelId,
      data.textChannelId,
      data.userRoles ?? [],
      data.isUserAloneInChannel ?? false
    );
  }
}

/**
 * Pause Music Command
 */
export class PauseMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    userRoles?: string[];
  }): PauseMusicCommand {
    return new PauseMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.userRoles ?? []
    );
  }
}

/**
 * Resume Music Command
 */
export class ResumeMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    userRoles?: string[];
  }): ResumeMusicCommand {
    return new ResumeMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.userRoles ?? []
    );
  }
}

/**
 * Stop Music Command
 */
export class StopMusicCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly userRoles: string[] = [],
    public readonly reason: 'user_requested' | 'error' | 'timeout' = 'user_requested',
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    userRoles?: string[];
    reason?: 'user_requested' | 'error' | 'timeout';
  }): StopMusicCommand {
    return new StopMusicCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.userRoles ?? [],
      data.reason ?? 'user_requested'
    );
  }
}

/**
 * Set Volume Command
 */
export class SetVolumeCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly volume: number,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {
    if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
      throw new Error('Volume must be an integer between 0 and 200');
    }
  }

  static create(data: {
    guildId: string;
    userId: string;
    volume: number;
    userRoles?: string[];
  }): SetVolumeCommand {
    return new SetVolumeCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.volume,
      data.userRoles ?? []
    );
  }
}

/**
 * Set Loop Mode Command
 */
export class SetLoopModeCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly loopMode: 'off' | 'track' | 'queue',
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    loopMode: 'off' | 'track' | 'queue';
    userRoles?: string[];
  }): SetLoopModeCommand {
    return new SetLoopModeCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.loopMode,
      data.userRoles ?? []
    );
  }
}
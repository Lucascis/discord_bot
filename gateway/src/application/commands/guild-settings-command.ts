import { GuildId } from '../../domain/value-objects/guild-id.js';
import { UserId } from '../../domain/value-objects/user-id.js';

/**
 * Update Automix Setting Command
 */
export class UpdateAutomixSettingCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly enabled: boolean,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    enabled: boolean;
    userRoles?: string[];
  }): UpdateAutomixSettingCommand {
    return new UpdateAutomixSettingCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.enabled,
      data.userRoles ?? []
    );
  }
}

/**
 * Set DJ Role Command
 */
export class SetDjRoleCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly roleName: string | null,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {
    if (roleName !== null && (typeof roleName !== 'string' || roleName.trim().length === 0)) {
      throw new Error('Role name must be a non-empty string or null');
    }
  }

  static create(data: {
    guildId: string;
    userId: string;
    roleName: string | null;
    userRoles?: string[];
  }): SetDjRoleCommand {
    return new SetDjRoleCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.roleName,
      data.userRoles ?? []
    );
  }
}

/**
 * Set Default Volume Command
 */
export class SetDefaultVolumeCommand {
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
  }): SetDefaultVolumeCommand {
    return new SetDefaultVolumeCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.volume,
      data.userRoles ?? []
    );
  }
}

/**
 * Set Max Queue Size Command
 */
export class SetMaxQueueSizeCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly maxSize: number,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {
    if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 1000) {
      throw new Error('Max queue size must be an integer between 1 and 1000');
    }
  }

  static create(data: {
    guildId: string;
    userId: string;
    maxSize: number;
    userRoles?: string[];
  }): SetMaxQueueSizeCommand {
    return new SetMaxQueueSizeCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.maxSize,
      data.userRoles ?? []
    );
  }
}

/**
 * Set Explicit Content Setting Command
 */
export class SetExplicitContentCommand {
  constructor(
    public readonly guildId: GuildId,
    public readonly userId: UserId,
    public readonly allowExplicit: boolean,
    public readonly userRoles: string[] = [],
    public readonly requestedAt: Date = new Date()
  ) {}

  static create(data: {
    guildId: string;
    userId: string;
    allowExplicit: boolean;
    userRoles?: string[];
  }): SetExplicitContentCommand {
    return new SetExplicitContentCommand(
      GuildId.from(data.guildId),
      UserId.from(data.userId),
      data.allowExplicit,
      data.userRoles ?? []
    );
  }
}
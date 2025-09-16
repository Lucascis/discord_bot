import { GuildId } from '../value-objects/guild-id.js';

/**
 * Guild Settings Entity
 * Represents configuration settings for a Discord guild
 */
export class GuildSettings {
  constructor(
    private readonly _guildId: GuildId,
    private _automixEnabled: boolean = false,
    private _djRoleName: string | null = null,
    private _defaultVolume: number = 100,
    private _maxQueueSize: number = 100,
    private _allowExplicit: boolean = true,
    private _updatedAt: Date = new Date()
  ) {
    this.validateVolume(_defaultVolume);
    this.validateQueueSize(_maxQueueSize);
  }

  get guildId(): GuildId {
    return this._guildId;
  }

  get automixEnabled(): boolean {
    return this._automixEnabled;
  }

  get djRoleName(): string | null {
    return this._djRoleName;
  }

  get defaultVolume(): number {
    return this._defaultVolume;
  }

  get maxQueueSize(): number {
    return this._maxQueueSize;
  }

  get allowExplicit(): boolean {
    return this._allowExplicit;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  enableAutomix(): void {
    this._automixEnabled = true;
    this._updatedAt = new Date();
  }

  disableAutomix(): void {
    this._automixEnabled = false;
    this._updatedAt = new Date();
  }

  setDjRole(roleName: string | null): void {
    this._djRoleName = roleName;
    this._updatedAt = new Date();
  }

  setDefaultVolume(volume: number): void {
    this.validateVolume(volume);
    this._defaultVolume = volume;
    this._updatedAt = new Date();
  }

  setMaxQueueSize(size: number): void {
    this.validateQueueSize(size);
    this._maxQueueSize = size;
    this._updatedAt = new Date();
  }

  setAllowExplicit(allow: boolean): void {
    this._allowExplicit = allow;
    this._updatedAt = new Date();
  }

  private validateVolume(volume: number): void {
    if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
      throw new Error('Volume must be an integer between 0 and 200');
    }
  }

  private validateQueueSize(size: number): void {
    if (!Number.isInteger(size) || size < 1 || size > 1000) {
      throw new Error('Queue size must be an integer between 1 and 1000');
    }
  }

  static create(guildId: GuildId): GuildSettings {
    return new GuildSettings(guildId);
  }

  static fromData(data: {
    guildId: string;
    automixEnabled?: boolean;
    djRoleName?: string | null;
    defaultVolume?: number;
    maxQueueSize?: number;
    allowExplicit?: boolean;
    updatedAt?: Date;
  }): GuildSettings {
    return new GuildSettings(
      GuildId.from(data.guildId),
      data.automixEnabled ?? false,
      data.djRoleName ?? null,
      data.defaultVolume ?? 100,
      data.maxQueueSize ?? 100,
      data.allowExplicit ?? true,
      data.updatedAt ?? new Date()
    );
  }

  toData(): {
    guildId: string;
    automixEnabled: boolean;
    djRoleName: string | null;
    defaultVolume: number;
    maxQueueSize: number;
    allowExplicit: boolean;
    updatedAt: Date;
  } {
    return {
      guildId: this._guildId.value,
      automixEnabled: this._automixEnabled,
      djRoleName: this._djRoleName,
      defaultVolume: this._defaultVolume,
      maxQueueSize: this._maxQueueSize,
      allowExplicit: this._allowExplicit,
      updatedAt: this._updatedAt
    };
  }
}
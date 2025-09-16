import { GuildSettings } from '../entities/guild-settings.js';
import { GuildId } from '../value-objects/guild-id.js';

/**
 * Guild Settings Repository Interface
 * Defines contract for persisting guild settings
 */
export interface GuildSettingsRepository {
  /**
   * Find guild settings by guild ID
   */
  findByGuildId(guildId: GuildId): Promise<GuildSettings | null>;

  /**
   * Save guild settings
   */
  save(settings: GuildSettings): Promise<void>;

  /**
   * Delete guild settings
   */
  delete(guildId: GuildId): Promise<void>;

  /**
   * Check if guild settings exist
   */
  exists(guildId: GuildId): Promise<boolean>;

  /**
   * Find all guilds with automix enabled
   */
  findAllWithAutomixEnabled(): Promise<GuildSettings[]>;

  /**
   * Bulk update settings for multiple guilds
   */
  bulkUpdate(settings: GuildSettings[]): Promise<void>;
}
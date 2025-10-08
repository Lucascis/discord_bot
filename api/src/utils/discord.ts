/**
 * Discord-specific utility functions
 *
 * Helper functions for Discord API interactions, validation,
 * and data formatting following Discord.js v14 patterns
 */

import type { Snowflake } from '../types/api.js';

/**
 * Discord Snowflake utilities
 */

// Discord epoch (first second of 2015)
const DISCORD_EPOCH = 1420070400000;

/**
 * Validates if a string is a valid Discord snowflake
 * @param id - The ID to validate
 * @returns true if valid snowflake, false otherwise
 */
export function isValidSnowflake(id: string): boolean {
  if (typeof id !== 'string') return false;

  // Snowflakes are 17-19 digit integers
  if (!/^\d{17,19}$/.test(id)) return false;

  // Parse as BigInt to handle large numbers
  try {
    const snowflake = BigInt(id);

    // Extract timestamp from snowflake
    const timestamp = Number(snowflake >> 22n) + DISCORD_EPOCH;

    // Check if timestamp is reasonable (after Discord epoch, not too far in future)
    const now = Date.now();
    return timestamp > DISCORD_EPOCH && timestamp <= now + 86400000; // Allow 1 day in future
  } catch {
    return false;
  }
}

/**
 * Extracts timestamp from Discord snowflake
 * @param snowflake - Discord snowflake ID
 * @returns Date object of when the snowflake was created
 */
export function getSnowflakeTimestamp(snowflake: Snowflake): Date {
  if (!isValidSnowflake(snowflake)) {
    throw new Error('Invalid snowflake provided');
  }

  const timestamp = Number(BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
  return new Date(timestamp);
}

/**
 * Discord CDN utilities
 */

/**
 * Generates Discord CDN avatar URL
 * @param userId - User snowflake ID
 * @param avatarHash - Avatar hash from Discord API
 * @param size - Image size (must be power of 2, between 16 and 4096)
 * @param format - Image format
 * @returns Full CDN URL for avatar
 */
export function getAvatarURL(
  userId: Snowflake,
  avatarHash: string | null,
  size: number = 256,
  format: 'png' | 'jpg' | 'webp' | 'gif' = 'webp'
): string {
  // Validate size (must be power of 2)
  if (!Number.isInteger(Math.log2(size)) || size < 16 || size > 4096) {
    throw new Error('Size must be a power of 2 between 16 and 4096');
  }

  if (!avatarHash) {
    // Default avatar (based on user discriminator)
    const defaultAvatar = (BigInt(userId) >> 22n) % 6n;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
  }

  // Animated avatars use gif format
  const actualFormat = avatarHash.startsWith('a_') && format === 'gif' ? 'gif' : format;

  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${actualFormat}?size=${size}`;
}

/**
 * Generates Discord CDN guild icon URL
 * @param guildId - Guild snowflake ID
 * @param iconHash - Icon hash from Discord API
 * @param size - Image size
 * @param format - Image format
 * @returns Full CDN URL for guild icon
 */
export function getGuildIconURL(
  guildId: Snowflake,
  iconHash: string | null,
  size: number = 256,
  format: 'png' | 'jpg' | 'webp' | 'gif' = 'webp'
): string | null {
  if (!iconHash) return null;

  if (!Number.isInteger(Math.log2(size)) || size < 16 || size > 4096) {
    throw new Error('Size must be a power of 2 between 16 and 4096');
  }

  const actualFormat = iconHash.startsWith('a_') && format === 'gif' ? 'gif' : format;

  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${actualFormat}?size=${size}`;
}

/**
 * Discord permission utilities
 */

// Discord permission bit flags
export const DiscordPermissions = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS_AND_STICKERS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n
} as const;

/**
 * Checks if permission bitfield has specific permission
 * @param permissions - Permission bitfield as string
 * @param permission - Permission to check
 * @returns true if permission is granted
 */
export function hasPermission(permissions: string, permission: bigint): boolean {
  const perms = BigInt(permissions);
  return (perms & permission) === permission;
}

/**
 * Required permissions for music bot operations
 */
export const REQUIRED_MUSIC_PERMISSIONS =
  DiscordPermissions.VIEW_CHANNEL |
  DiscordPermissions.SEND_MESSAGES |
  DiscordPermissions.EMBED_LINKS |
  DiscordPermissions.CONNECT |
  DiscordPermissions.SPEAK |
  DiscordPermissions.USE_VAD;

/**
 * Discord message formatting utilities
 */

/**
 * Escapes Discord markdown in text
 * @param text - Text to escape
 * @returns Escaped text safe for Discord
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`~\\|])/g, '\\$1');
}

/**
 * Formats duration in seconds to Discord-friendly format
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "3:42", "1:23:45")
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Truncates text to fit Discord's character limits
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add when truncated
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) return text;

  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Discord color constants
 */
export const DiscordColors = {
  BLURPLE: 0x5865F2,
  GREEN: 0x57F287,
  YELLOW: 0xFEE75C,
  FUCHSIA: 0xEB459E,
  RED: 0xED4245,
  WHITE: 0xFFFFFF,
  BLACK: 0x000000,
  DARK_GREY: 0x36393F,
  LIGHT_GREY: 0x95A5A6
} as const;
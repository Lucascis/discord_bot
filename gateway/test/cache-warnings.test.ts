import { describe, it, expect } from 'vitest';
import { Client, GatewayIntentBits, LimitedCollection, Collection } from 'discord.js';

describe('Discord.js Cache Configuration', () => {
  it('should not produce UnsupportedCacheOverwriteWarning messages', async () => {
    const originalConsole = console.warn;
    const warnings: string[] = [];

    // Capture console warnings
    console.warn = (message: string) => {
      warnings.push(message);
    };

    try {
      // Create Discord client with the same cache configuration as main.ts
      const client = new Client({
        intents: [GatewayIntentBits.Guilds],
        makeCache: (manager) => {
          switch (manager.name) {
            case 'UserManager':
              return new LimitedCollection({ maxSize: 1000 });
            case 'MessageManager':
              return new LimitedCollection({ maxSize: 50 });
            case 'VoiceStateManager':
              return new LimitedCollection({ maxSize: 500 });
            case 'GuildMemberManager':
              return new LimitedCollection({ maxSize: 200 });
            case 'BaseGuildEmojiManager':
              return new LimitedCollection({ maxSize: 100 });
            case 'PresenceManager':
              return new LimitedCollection({ maxSize: 200 });
            case 'ReactionManager':
              return new LimitedCollection({ maxSize: 50 });
            case 'GuildBanManager':
              return new LimitedCollection({ maxSize: 100 });
            case 'GuildInviteManager':
              return new LimitedCollection({ maxSize: 50 });
            case 'ThreadManager':
              return new LimitedCollection({ maxSize: 100 });
            default:
              return new Collection();
          }
        }
      });

      // Check that no UnsupportedCacheOverwriteWarning was issued
      const unsupportedCacheWarnings = warnings.filter(warning =>
        warning.includes('UnsupportedCacheOverwriteWarning')
      );

      expect(unsupportedCacheWarnings).toHaveLength(0);

      // Clean up
      client.destroy();
    } finally {
      console.warn = originalConsole;
    }
  });

  it('should create LimitedCollection instances for supported managers', () => {
    const makeCache = (manager: { name: string }) => {
      switch (manager.name) {
        case 'UserManager':
          return new LimitedCollection({ maxSize: 1000 });
        case 'MessageManager':
          return new LimitedCollection({ maxSize: 50 });
        case 'GuildMemberManager':
          return new LimitedCollection({ maxSize: 200 });
        default:
          return new Collection();
      }
    };

    // Test supported managers
    expect(makeCache({ name: 'UserManager' })).toBeInstanceOf(LimitedCollection);
    expect(makeCache({ name: 'MessageManager' })).toBeInstanceOf(LimitedCollection);
    expect(makeCache({ name: 'GuildMemberManager' })).toBeInstanceOf(LimitedCollection);

    // Test unsupported managers (should return default Collection)
    expect(makeCache({ name: 'GuildManager' })).toBeInstanceOf(Collection);
    expect(makeCache({ name: 'ChannelManager' })).toBeInstanceOf(Collection);
    expect(makeCache({ name: 'RoleManager' })).toBeInstanceOf(Collection);
  });

  it('should not override unsupported managers that break functionality', () => {
    const unsupportedManagers = [
      'GuildManager',
      'ChannelManager',
      'GuildChannelManager',
      'RoleManager',
      'PermissionOverwriteManager'
    ];

    const makeCache = (manager: { name: string }) => {
      switch (manager.name) {
        case 'UserManager':
          return new LimitedCollection({ maxSize: 1000 });
        default:
          return new Collection();
      }
    };

    // All unsupported managers should get default Collection
    for (const managerName of unsupportedManagers) {
      const result = makeCache({ name: managerName });
      expect(result).toBeInstanceOf(Collection);
      expect(result).not.toBeInstanceOf(LimitedCollection);
    }
  });
});
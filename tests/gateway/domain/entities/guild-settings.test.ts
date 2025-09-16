import { describe, it, expect } from 'vitest';
import { GuildSettings } from '../../../../gateway/src/domain/entities/guild-settings.js';
import { GuildId } from '../../../../gateway/src/domain/value-objects/guild-id.js';

describe('GuildSettings Entity', () => {
  describe('Creation', () => {
    it('should create guild settings with default values', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      expect(settings.guildId).toBe(guildId);
      expect(settings.automixEnabled).toBe(false);
      expect(settings.djRoleName).toBe(null);
      expect(settings.defaultVolume).toBe(100);
      expect(settings.maxQueueSize).toBe(100);
      expect(settings.allowExplicit).toBe(true);
    });

    it('should create from data object', () => {
      const data = {
        guildId: '123456789012345678',
        automixEnabled: true,
        djRoleName: 'DJ',
        defaultVolume: 75,
        maxQueueSize: 50,
        allowExplicit: false
      };

      const settings = GuildSettings.fromData(data);

      expect(settings.guildId.value).toBe(data.guildId);
      expect(settings.automixEnabled).toBe(true);
      expect(settings.djRoleName).toBe('DJ');
      expect(settings.defaultVolume).toBe(75);
      expect(settings.maxQueueSize).toBe(50);
      expect(settings.allowExplicit).toBe(false);
    });
  });

  describe('Automix Management', () => {
    it('should enable automix', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      settings.enableAutomix();

      expect(settings.automixEnabled).toBe(true);
    });

    it('should disable automix', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);
      settings.enableAutomix();

      settings.disableAutomix();

      expect(settings.automixEnabled).toBe(false);
    });
  });

  describe('Volume Management', () => {
    it('should set valid volume', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      settings.setDefaultVolume(75);

      expect(settings.defaultVolume).toBe(75);
    });

    it('should reject invalid volume values', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      expect(() => settings.setDefaultVolume(-1)).toThrow('Volume must be an integer between 0 and 200');
      expect(() => settings.setDefaultVolume(201)).toThrow('Volume must be an integer between 0 and 200');
      expect(() => settings.setDefaultVolume(50.5)).toThrow('Volume must be an integer between 0 and 200');
    });
  });

  describe('Queue Size Management', () => {
    it('should set valid queue size', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      settings.setMaxQueueSize(50);

      expect(settings.maxQueueSize).toBe(50);
    });

    it('should reject invalid queue size values', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      expect(() => settings.setMaxQueueSize(0)).toThrow('Queue size must be an integer between 1 and 1000');
      expect(() => settings.setMaxQueueSize(1001)).toThrow('Queue size must be an integer between 1 and 1000');
    });
  });

  describe('DJ Role Management', () => {
    it('should set DJ role', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);

      settings.setDjRole('DJ');

      expect(settings.djRoleName).toBe('DJ');
    });

    it('should clear DJ role', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);
      settings.setDjRole('DJ');

      settings.setDjRole(null);

      expect(settings.djRoleName).toBe(null);
    });
  });

  describe('Data Conversion', () => {
    it('should convert to data object', () => {
      const guildId = GuildId.from('123456789012345678');
      const settings = GuildSettings.create(guildId);
      settings.enableAutomix();
      settings.setDjRole('DJ');
      settings.setDefaultVolume(75);

      const data = settings.toData();

      expect(data.guildId).toBe('123456789012345678');
      expect(data.automixEnabled).toBe(true);
      expect(data.djRoleName).toBe('DJ');
      expect(data.defaultVolume).toBe(75);
      expect(data.updatedAt).toBeInstanceOf(Date);
    });
  });
});
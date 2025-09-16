import { describe, it, expect } from 'vitest';
import { MusicSession } from '../../../../gateway/src/domain/entities/music-session.js';
import { GuildId } from '../../../../gateway/src/domain/value-objects/guild-id.js';

describe('MusicSession Entity', () => {
  describe('Creation', () => {
    it('should create session with default values', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      expect(session.guildId).toBe(guildId);
      expect(session.state).toBe('idle');
      expect(session.currentTrack).toBe(null);
      expect(session.volume).toBe(100);
      expect(session.position).toBe(0);
      expect(session.loopMode).toBe('off');
      expect(session.queueLength).toBe(0);
      expect(session.isPaused).toBe(false);
      expect(session.isActive).toBe(false);
      expect(session.isIdle).toBe(true);
    });

    it('should create from data object', () => {
      const data = {
        guildId: '123456789012345678',
        state: 'playing' as const,
        currentTrack: 'Test Track',
        volume: 75,
        position: 30000,
        loopMode: 'track' as const,
        queueLength: 5,
        voiceChannelId: '987654321098765432',
        textChannelId: '567890123456789012',
        isPaused: false
      };

      const session = MusicSession.fromData(data);

      expect(session.guildId.value).toBe(data.guildId);
      expect(session.state).toBe('playing');
      expect(session.currentTrack).toBe('Test Track');
      expect(session.volume).toBe(75);
      expect(session.position).toBe(30000);
      expect(session.loopMode).toBe('track');
      expect(session.queueLength).toBe(5);
      expect(session.isActive).toBe(true);
    });
  });

  describe('Playback Control', () => {
    it('should start playing', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.startPlaying('Test Track', 'voice123', 'text123');

      expect(session.state).toBe('playing');
      expect(session.currentTrack).toBe('Test Track');
      expect(session.voiceChannelId).toBe('voice123');
      expect(session.textChannelId).toBe('text123');
      expect(session.isPaused).toBe(false);
      expect(session.position).toBe(0);
      expect(session.isActive).toBe(true);
    });

    it('should pause when playing', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.startPlaying('Test Track', 'voice123', 'text123');

      session.pause();

      expect(session.state).toBe('paused');
      expect(session.isPaused).toBe(true);
      expect(session.isActive).toBe(true);
    });

    it('should not pause when not playing', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.pause();

      expect(session.state).toBe('idle');
      expect(session.isPaused).toBe(false);
    });

    it('should resume when paused', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.startPlaying('Test Track', 'voice123', 'text123');
      session.pause();

      session.resume();

      expect(session.state).toBe('playing');
      expect(session.isPaused).toBe(false);
      expect(session.isActive).toBe(true);
    });

    it('should stop playing', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.startPlaying('Test Track', 'voice123', 'text123');

      session.stop();

      expect(session.state).toBe('stopped');
      expect(session.currentTrack).toBe(null);
      expect(session.position).toBe(0);
      expect(session.isPaused).toBe(false);
    });

    it('should disconnect and reset', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.startPlaying('Test Track', 'voice123', 'text123');

      session.disconnect();

      expect(session.state).toBe('idle');
      expect(session.currentTrack).toBe(null);
      expect(session.voiceChannelId).toBe(null);
      expect(session.textChannelId).toBe(null);
      expect(session.position).toBe(0);
      expect(session.queueLength).toBe(0);
      expect(session.isIdle).toBe(true);
    });
  });

  describe('Volume Control', () => {
    it('should set valid volume', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.setVolume(75);

      expect(session.volume).toBe(75);
    });

    it('should reject invalid volume values', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      expect(() => session.setVolume(-1)).toThrow('Volume must be an integer between 0 and 200');
      expect(() => session.setVolume(201)).toThrow('Volume must be an integer between 0 and 200');
      expect(() => session.setVolume(50.5)).toThrow('Volume must be an integer between 0 and 200');
    });
  });

  describe('Position Management', () => {
    it('should set valid position', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.setPosition(30000);

      expect(session.position).toBe(30000);
    });

    it('should reject negative position', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      expect(() => session.setPosition(-1)).toThrow('Position cannot be negative');
    });
  });

  describe('Loop Mode', () => {
    it('should set loop mode', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.setLoopMode('track');

      expect(session.loopMode).toBe('track');
    });
  });

  describe('Queue Management', () => {
    it('should update queue length', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.updateQueueLength(5);

      expect(session.queueLength).toBe(5);
    });

    it('should add to queue', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      session.addToQueue();
      session.addToQueue();

      expect(session.queueLength).toBe(2);
    });

    it('should skip to next track', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.updateQueueLength(3);
      session.setPosition(30000);

      session.skipToNext();

      expect(session.queueLength).toBe(2);
      expect(session.position).toBe(0);
    });

    it('should reject negative queue length', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);

      expect(() => session.updateQueueLength(-1)).toThrow('Queue length cannot be negative');
    });
  });

  describe('Data Conversion', () => {
    it('should convert to data object', () => {
      const guildId = GuildId.from('123456789012345678');
      const session = MusicSession.create(guildId);
      session.startPlaying('Test Track', 'voice123', 'text123');
      session.setVolume(75);
      session.setLoopMode('track');

      const data = session.toData();

      expect(data.guildId).toBe('123456789012345678');
      expect(data.state).toBe('playing');
      expect(data.currentTrack).toBe('Test Track');
      expect(data.volume).toBe(75);
      expect(data.loopMode).toBe('track');
      expect(data.voiceChannelId).toBe('voice123');
      expect(data.textChannelId).toBe('text123');
      expect(data.lastUpdated).toBeInstanceOf(Date);
    });
  });
});
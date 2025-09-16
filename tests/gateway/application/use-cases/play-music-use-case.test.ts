import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayMusicUseCase } from '../../../../gateway/src/application/use-cases/play-music-use-case.js';
import { PlayMusicCommand } from '../../../../gateway/src/application/commands/play-music-command.js';
import { GuildSettings } from '../../../../gateway/src/domain/entities/guild-settings.js';
import { MusicSession } from '../../../../gateway/src/domain/entities/music-session.js';
import { GuildId } from '../../../../gateway/src/domain/value-objects/guild-id.js';

// Mock implementations
const mockMusicSessionRepository = {
  findByGuildId: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
  findAllActive: vi.fn(),
  findIdleSessions: vi.fn(),
  updateState: vi.fn(),
  updatePosition: vi.fn(),
  cleanupIdleSessions: vi.fn()
};

const mockGuildSettingsRepository = {
  findByGuildId: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  findAllWithAutomixEnabled: vi.fn(),
  bulkUpdate: vi.fn()
};

const mockMusicSessionDomainService = {
  canUserControlMusic: vi.fn(),
  shouldAutoDisconnect: vi.fn(),
  calculateRecommendedVolume: vi.fn(),
  isValidStateTransition: vi.fn(),
  shouldTriggerAutomix: vi.fn(),
  calculateSessionStats: vi.fn(),
  calculateOptimalQueueSize: vi.fn()
};

const mockAudioService = {
  searchTrack: vi.fn(),
  playTrack: vi.fn(),
  isConnectedToVoice: vi.fn(),
  connectToVoice: vi.fn()
};

const mockPermissionService = {
  hasPermissionToControlMusic: vi.fn(),
  isUserInVoiceChannel: vi.fn(),
  isUserAloneInVoiceChannel: vi.fn()
};

describe('PlayMusicUseCase', () => {
  let useCase: PlayMusicUseCase;
  let guildId: GuildId;
  let guildSettings: GuildSettings;
  let musicSession: MusicSession;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    useCase = new PlayMusicUseCase(
      mockMusicSessionRepository,
      mockGuildSettingsRepository,
      mockMusicSessionDomainService,
      mockAudioService,
      mockPermissionService
    );

    guildId = GuildId.from('123456789012345678');
    guildSettings = GuildSettings.create(guildId);
    musicSession = MusicSession.create(guildId);

    // Default mock implementations
    mockGuildSettingsRepository.findByGuildId.mockResolvedValue(guildSettings);
    mockMusicSessionRepository.findByGuildId.mockResolvedValue(musicSession);
    mockMusicSessionDomainService.canUserControlMusic.mockReturnValue(true);
    mockAudioService.isConnectedToVoice.mockResolvedValue(false);
    mockAudioService.searchTrack.mockResolvedValue({
      tracks: [{ title: 'Test Song', uri: 'test-uri', duration: 180000 }],
      source: 'youtube',
      latency: 100,
      cached: false
    });
    mockAudioService.playTrack.mockResolvedValue({
      success: true,
      message: 'Track playing'
    });
  });

  describe('Successful Play Command', () => {
    it('should play music successfully when user has permission', async () => {
      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123',
        userRoles: [],
        isUserAloneInChannel: false
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(true);
      expect(result.trackTitle).toBe('Test Song');
      expect(result.message).toContain('Test Song');
      expect(mockAudioService.searchTrack).toHaveBeenCalledWith('test song', '123456789012345678');
      expect(mockAudioService.connectToVoice).toHaveBeenCalledWith('123456789012345678', 'voice123');
      expect(mockAudioService.playTrack).toHaveBeenCalledWith('123456789012345678', 'test-uri', 'voice123');
      expect(mockMusicSessionRepository.save).toHaveBeenCalled();
    });

    it('should add to queue when session is already active', async () => {
      // Setup active session
      musicSession.startPlaying('Current Song', 'voice123', 'text123');
      mockMusicSessionRepository.findByGuildId.mockResolvedValue(musicSession);
      mockAudioService.playTrack.mockResolvedValue({
        success: true,
        message: 'Added to queue',
        queuePosition: 2
      });

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(true);
      expect(result.queuePosition).toBe(2);
      expect(result.message).toContain('Added');
      expect(result.message).toContain('position 2');
    });

    it('should skip voice connection if already connected', async () => {
      mockAudioService.isConnectedToVoice.mockResolvedValue(true);

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      await useCase.execute(command);

      expect(mockAudioService.connectToVoice).not.toHaveBeenCalled();
    });
  });

  describe('Permission Checks', () => {
    it('should reject when user lacks permission', async () => {
      mockMusicSessionDomainService.canUserControlMusic.mockReturnValue(false);

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(false);
      expect(result.message).toContain('permission');
      expect(mockAudioService.searchTrack).not.toHaveBeenCalled();
    });

    it('should consider user roles in permission check', async () => {
      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123',
        userRoles: ['DJ', 'Moderator']
      });

      await useCase.execute(command);

      expect(mockMusicSessionDomainService.canUserControlMusic).toHaveBeenCalledWith(
        expect.anything(), // UserId
        guildSettings,
        ['DJ', 'Moderator'],
        true,
        false
      );
    });
  });

  describe('Search Handling', () => {
    it('should handle empty search results', async () => {
      mockAudioService.searchTrack.mockResolvedValue({
        tracks: [],
        source: 'youtube',
        latency: 100,
        cached: false
      });

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'nonexistent song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No tracks found');
      expect(mockAudioService.playTrack).not.toHaveBeenCalled();
    });

    it('should emit search events', async () => {
      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.events).toHaveLength(3); // SearchRequested, SearchCompleted, MusicSessionStarted
      expect(result.events[0].eventType).toBe('SearchRequested');
      expect(result.events[1].eventType).toBe('SearchCompleted');
    });
  });

  describe('Audio Service Failures', () => {
    it('should handle play failure', async () => {
      mockAudioService.playTrack.mockResolvedValue({
        success: false,
        message: 'Failed to play track'
      });

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to play track');
    });

    it('should handle search errors', async () => {
      mockAudioService.searchTrack.mockRejectedValue(new Error('Search service unavailable'));

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      const result = await useCase.execute(command);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Search service unavailable');
    });
  });

  describe('Repository Creation', () => {
    it('should create guild settings if not found', async () => {
      mockGuildSettingsRepository.findByGuildId.mockResolvedValue(null);

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      await useCase.execute(command);

      expect(mockGuildSettingsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: expect.objectContaining({ value: '123456789012345678' })
        })
      );
    });

    it('should create music session if not found', async () => {
      mockMusicSessionRepository.findByGuildId.mockResolvedValue(null);

      const command = PlayMusicCommand.create({
        guildId: '123456789012345678',
        userId: '987654321098765432',
        query: 'test song',
        voiceChannelId: 'voice123',
        textChannelId: 'text123'
      });

      await useCase.execute(command);

      expect(mockMusicSessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: expect.objectContaining({ value: '123456789012345678' })
        })
      );
    });
  });
});
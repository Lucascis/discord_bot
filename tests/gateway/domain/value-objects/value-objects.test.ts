import { describe, it, expect } from 'vitest';
import { GuildId } from '../../../../gateway/src/domain/value-objects/guild-id.js';
import { UserId } from '../../../../gateway/src/domain/value-objects/user-id.js';
import { SearchQuery } from '../../../../gateway/src/domain/value-objects/search-query.js';

describe('Value Objects', () => {
  describe('GuildId', () => {
    it('should create valid guild ID', () => {
      const guildId = new GuildId('123456789012345678');
      expect(guildId.value).toBe('123456789012345678');
    });

    it('should reject invalid guild IDs', () => {
      expect(() => new GuildId('')).toThrow('Guild ID must be a non-empty string');
      expect(() => new GuildId('123')).toThrow('Guild ID must be a valid Discord snowflake');
      expect(() => new GuildId('12345678901234567890')).toThrow('Guild ID must be a valid Discord snowflake');
      expect(() => new GuildId('abc123')).toThrow('Guild ID must be a valid Discord snowflake');
    });

    it('should check equality', () => {
      const guildId1 = new GuildId('123456789012345678');
      const guildId2 = new GuildId('123456789012345678');
      const guildId3 = new GuildId('987654321098765432');

      expect(guildId1.equals(guildId2)).toBe(true);
      expect(guildId1.equals(guildId3)).toBe(false);
    });

    it('should convert to string', () => {
      const guildId = new GuildId('123456789012345678');
      expect(guildId.toString()).toBe('123456789012345678');
    });

    it('should create from static method', () => {
      const guildId = GuildId.from('123456789012345678');
      expect(guildId.value).toBe('123456789012345678');
    });
  });

  describe('UserId', () => {
    it('should create valid user ID', () => {
      const userId = new UserId('123456789012345678');
      expect(userId.value).toBe('123456789012345678');
    });

    it('should reject invalid user IDs', () => {
      expect(() => new UserId('')).toThrow('User ID must be a non-empty string');
      expect(() => new UserId('123')).toThrow('User ID must be a valid Discord snowflake');
    });

    it('should check equality', () => {
      const userId1 = new UserId('123456789012345678');
      const userId2 = new UserId('123456789012345678');
      const userId3 = new UserId('987654321098765432');

      expect(userId1.equals(userId2)).toBe(true);
      expect(userId1.equals(userId3)).toBe(false);
    });
  });

  describe('SearchQuery', () => {
    it('should create valid search query', () => {
      const query = new SearchQuery('test song');
      expect(query.value).toBe('test song');
    });

    it('should trim whitespace', () => {
      const query = new SearchQuery('  test song  ');
      expect(query.value).toBe('test song');
    });

    it('should reject invalid queries', () => {
      expect(() => new SearchQuery('')).toThrow('Search query must be a non-empty string');
      expect(() => new SearchQuery('   ')).toThrow('Search query cannot be empty or only whitespace');
      expect(() => new SearchQuery('a'.repeat(501))).toThrow('Search query cannot exceed 500 characters');
      expect(() => new SearchQuery('test<script>')).toThrow('Search query contains invalid characters');
    });

    it('should detect URLs', () => {
      const httpQuery = new SearchQuery('https://example.com/song');
      const httpsQuery = new SearchQuery('http://example.com/song');
      const textQuery = new SearchQuery('test song');

      expect(httpQuery.isUrl).toBe(true);
      expect(httpsQuery.isUrl).toBe(true);
      expect(textQuery.isUrl).toBe(false);
    });

    it('should detect YouTube URLs', () => {
      const youtubeQuery = new SearchQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const youtubeShortQuery = new SearchQuery('https://youtu.be/dQw4w9WgXcQ');
      const otherQuery = new SearchQuery('https://spotify.com/track/123');

      expect(youtubeQuery.isYouTubeUrl).toBe(true);
      expect(youtubeShortQuery.isYouTubeUrl).toBe(true);
      expect(otherQuery.isYouTubeUrl).toBe(false);
    });

    it('should detect Spotify URLs', () => {
      const spotifyQuery = new SearchQuery('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh');
      const otherQuery = new SearchQuery('https://youtube.com/watch?v=123');

      expect(spotifyQuery.isSpotifyUrl).toBe(true);
      expect(otherQuery.isSpotifyUrl).toBe(false);
    });

    it('should check equality', () => {
      const query1 = new SearchQuery('test song');
      const query2 = new SearchQuery('test song');
      const query3 = new SearchQuery('other song');

      expect(query1.equals(query2)).toBe(true);
      expect(query1.equals(query3)).toBe(false);
    });

    it('should create from static method', () => {
      const query = SearchQuery.from('test song');
      expect(query.value).toBe('test song');
    });
  });
});
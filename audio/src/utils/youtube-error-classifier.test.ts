import { describe, it, expect } from 'vitest';
import {
  classifyYouTubeError,
  YouTubeErrorType,
  getRecommendedAction
} from './youtube-error-classifier';

describe('YouTubeErrorClassifier', () => {
  describe('classifyYouTubeError', () => {
    it('should classify unavailable video errors', () => {
      const result = classifyYouTubeError('Video unavailable');
      expect(result.type).toBe(YouTubeErrorType.UNAVAILABLE);
      expect(result.retryable).toBe(false);
      expect(result.severity).toBe('info');
    });

    it('should classify region blocked errors', () => {
      const result = classifyYouTubeError('This video is not available in your country');
      expect(result.type).toBe(YouTubeErrorType.REGION_BLOCKED);
      expect(result.retryable).toBe(false);
    });

    it('should classify network errors', () => {
      const result = classifyYouTubeError('Connection timeout');
      expect(result.type).toBe(YouTubeErrorType.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
      expect(result.severity).toBe('warning');
    });

    it('should classify age restricted errors', () => {
      const result = classifyYouTubeError('This video is age restricted');
      expect(result.type).toBe(YouTubeErrorType.AGE_RESTRICTED);
      expect(result.retryable).toBe(false);
    });

    it('should classify login required errors', () => {
      const result = classifyYouTubeError('Please sign in to watch this video');
      expect(result.type).toBe(YouTubeErrorType.REQUIRES_LOGIN);
      expect(result.retryable).toBe(false);
    });

    it('should handle Error objects', () => {
      const error = new Error('Video deleted');
      const result = classifyYouTubeError(error);
      expect(result.type).toBe(YouTubeErrorType.UNAVAILABLE);
      expect(result.originalError).toBe(error);
    });

    it('should handle unknown errors', () => {
      const result = classifyYouTubeError('Some random error');
      expect(result.type).toBe(YouTubeErrorType.UNKNOWN);
      expect(result.retryable).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = classifyYouTubeError('VIDEO UNAVAILABLE');
      expect(result.type).toBe(YouTubeErrorType.UNAVAILABLE);
    });
  });

  describe('getRecommendedAction', () => {
    it('should recommend retry for retryable errors', () => {
      const classified = classifyYouTubeError('Connection timeout');
      const action = getRecommendedAction(classified);
      expect(action).toBe('retry');
    });

    it('should recommend skip for non-retryable errors', () => {
      const classified = classifyYouTubeError('Video unavailable');
      const action = getRecommendedAction(classified);
      expect(action).toBe('skip');
    });
  });
});

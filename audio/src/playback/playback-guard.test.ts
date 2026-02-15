import { describe, expect, it } from 'vitest';
import { shouldAttemptPlaybackRecovery, validatePlaybackPreconditions } from './playback-guard.js';

describe('playback guard', () => {
  it('rejects playback when voice credentials are missing', () => {
    const result = validatePlaybackPreconditions({
      hasNode: true,
      hasVoiceCredentials: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('voice_credentials_missing');
  });

  it('allows playback when node and voice credentials are present', () => {
    const result = validatePlaybackPreconditions({
      hasNode: true,
      hasVoiceCredentials: true,
    });

    expect(result.ok).toBe(true);
  });

  it('requests a single recovery when playback is still inactive', () => {
    const result = shouldAttemptPlaybackRecovery({
      isPlaying: false,
      playingPlayers: 0,
    });

    expect(result).toBe(true);
    expect(shouldAttemptPlaybackRecovery({ isPlaying: true, playingPlayers: 1 })).toBe(false);
  });
});

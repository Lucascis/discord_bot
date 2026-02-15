export type PlaybackGuardFailure = 'voice_credentials_missing' | 'node_inactive' | 'transport_not_ready';

export interface PlaybackPreconditionInput {
  hasNode: boolean;
  hasVoiceCredentials: boolean;
}

export function validatePlaybackPreconditions(input: PlaybackPreconditionInput): {
  ok: boolean;
  reason?: PlaybackGuardFailure;
} {
  if (!input.hasNode) {
    return { ok: false, reason: 'node_inactive' };
  }

  if (!input.hasVoiceCredentials) {
    return { ok: false, reason: 'voice_credentials_missing' };
  }

  return { ok: true };
}

export interface PlaybackRecoveryInput {
  isPlaying: boolean;
  playingPlayers?: number;
}

export function shouldAttemptPlaybackRecovery(input: PlaybackRecoveryInput): boolean {
  if (input.isPlaying) {
    return false;
  }

  if (typeof input.playingPlayers === 'number' && input.playingPlayers > 0) {
    return false;
  }

  return true;
}

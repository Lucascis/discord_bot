export interface ProbeConfig {
  token: string;
  guildId: string;
  voiceChannelId: string;
  windowMs: number;
  timeoutMs: number;
  rmsThreshold: number;
  consecutiveWindows: number;
}

export interface ProbeWindow {
  rms: number;
  timestamp: number;
}

export interface ProbeResult {
  passed: boolean;
  windows: ProbeWindow[];
  maxRms: number;
  reason?: string;
}

import { apiFetch } from './api-client';

export interface HealthCheckResult {
  status: string;
  responseTime?: number;
  lastCheck?: string;
  [key: string]: unknown;
}

export interface PlatformHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime?: number;
  timestamp: string;
  metrics?: Record<string, unknown>;
  checks?: Record<string, HealthCheckResult>;
}

export async function getPlatformHealth(): Promise<PlatformHealth | null> {
  try {
    return await apiFetch<PlatformHealth>('/health');
  } catch {
    return null;
  }
}

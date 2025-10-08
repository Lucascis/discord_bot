/**
 * Job Type Definitions for Worker Service
 *
 * Comprehensive TypeScript types for BullMQ job system
 * Following Discord bot specific requirements and best practices
 */

import type { Job } from 'bullmq';

/**
 * Base job data interface
 */
export interface BaseJobData {
  requestId: string;
  timestamp: string;
  priority?: number;
  userId?: string;
  guildId?: string;
}

/**
 * Cleanup job types
 */
export interface CleanupJobData extends BaseJobData {
  type: 'cleanup';
  subtype: 'queue_items' | 'rate_limits' | 'audit_logs' | 'cache' | 'temp_files';
  olderThanDays?: number;
  batchSize?: number;
}

/**
 * Analytics job types
 */
export interface AnalyticsJobData extends BaseJobData {
  type: 'analytics';
  subtype: 'playback_stats' | 'guild_usage' | 'user_engagement' | 'popular_tracks' | 'performance';
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  dateRange?: {
    start: string;
    end: string;
  };
}

/**
 * Database maintenance job types
 */
export interface MaintenanceJobData extends BaseJobData {
  type: 'maintenance';
  subtype: 'index_optimization' | 'vacuum' | 'analyze' | 'snapshot' | 'partition';
  tables?: string[];
  dryRun?: boolean;
}

/**
 * Health monitoring job types
 */
export interface HealthJobData extends BaseJobData {
  type: 'health';
  subtype: 'lavalink_nodes' | 'database' | 'redis' | 'api_limits' | 'memory_usage';
  threshold?: number;
  notifyOnFailure?: boolean;
}

/**
 * Union type for all job data
 */
export type JobData = CleanupJobData | AnalyticsJobData | MaintenanceJobData | HealthJobData;

/**
 * Job queue names
 */
export const QueueName = {
  CLEANUP: 'cleanup',
  ANALYTICS: 'analytics',
  MAINTENANCE: 'maintenance',
  HEALTH: 'health'
} as const;

export type QueueNameType = typeof QueueName[keyof typeof QueueName];

/**
 * Job priorities (higher number = higher priority)
 */
export const JobPriority = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 10,
  CRITICAL: 20
} as const;

export type JobPriorityType = typeof JobPriority[keyof typeof JobPriority];

/**
 * Job retry policies
 */
export interface RetryPolicy {
  attempts: number;
  backoff: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
}

/**
 * Job result interface
 */
export interface JobResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  timestamp: string;
  metrics?: Record<string, number>;
}

/**
 * Typed job processor function
 */
export type JobProcessor<T extends JobData = JobData> = (
  job: Job<T>
) => Promise<JobResult>;

/**
 * Job scheduling options
 */
export interface ScheduleOptions {
  cron?: string;
  repeat?: {
    every?: number;
    limit?: number;
  };
  delay?: number;
  priority?: JobPriorityType;
  removeOnComplete?: number;
  removeOnFail?: number;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  name: QueueNameType;
  defaultJobOptions: {
    removeOnComplete: number;
    removeOnFail: number;
    attempts: number;
    backoff: {
      type: 'exponential';
      delay: number;
    };
  };
  rateLimiter?: {
    max: number;
    duration: number;
  };
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  concurrency: number;
  limiter?: {
    max: number;
    duration: number;
  };
  stalledInterval: number;
  maxStalledCount: number;
}

/**
 * Error types for job failures
 */
export const JobErrorType = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  RESOURCE_ERROR: 'RESOURCE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type JobErrorTypeValue = typeof JobErrorType[keyof typeof JobErrorType];

/**
 * Structured job error
 */
export interface JobError {
  type: JobErrorTypeValue;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: string;
  retryable: boolean;
}

/**
 * Job metrics interface
 */
export interface JobMetrics {
  queueName: string;
  jobType: string;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  duration?: number;
  attempts: number;
  timestamp: string;
  error?: JobError;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency?: number;
  details?: Record<string, unknown>;
  timestamp: string;
}
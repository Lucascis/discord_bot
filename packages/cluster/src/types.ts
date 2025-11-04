/**
 * Cluster types and interfaces for distributed Discord bot architecture
 */

import { z } from 'zod';

export const CLUSTER_VERSION = '1.0.0';

/**
 * Service types in the cluster
 */
export enum ServiceType {
  GATEWAY = 'gateway',
  AUDIO = 'audio',
  API = 'api',
  WORKER = 'worker'
}

/**
 * Instance status states
 */
export enum InstanceStatus {
  STARTING = 'starting',
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  SHUTTING_DOWN = 'shutting_down',
  DEAD = 'dead'
}

/**
 * Instance metadata schema
 */
export const InstanceMetadataSchema = z.object({
  instanceId: z.string(),
  serviceType: z.nativeEnum(ServiceType),
  status: z.nativeEnum(InstanceStatus),
  hostname: z.string(),
  port: z.number(),
  startedAt: z.number(),
  lastHeartbeat: z.number(),
  version: z.string(),
  region: z.string().optional(),
  availableMemory: z.number(),
  cpuUsage: z.number(),
  assignedGuilds: z.array(z.string()),
  maxGuilds: z.number().default(1000)
});

export type InstanceMetadata = z.infer<typeof InstanceMetadataSchema>;

/**
 * Guild assignment information
 */
export const GuildAssignmentSchema = z.object({
  guildId: z.string(),
  instanceId: z.string(),
  serviceType: z.nativeEnum(ServiceType),
  assignedAt: z.number(),
  lastActivity: z.number(),
  hasVoiceConnection: z.boolean().default(false),
  playerActive: z.boolean().default(false)
});

export type GuildAssignment = z.infer<typeof GuildAssignmentSchema>;

/**
 * Heartbeat message
 */
export const HeartbeatMessageSchema = z.object({
  instanceId: z.string(),
  timestamp: z.number(),
  status: z.nativeEnum(InstanceStatus),
  metrics: z.object({
    guildCount: z.number(),
    activeVoiceConnections: z.number(),
    memoryUsage: z.number(),
    cpuUsage: z.number(),
    uptime: z.number()
  })
});

export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;

/**
 * Guild migration request
 */
export const MigrationRequestSchema = z.object({
  guildId: z.string(),
  fromInstanceId: z.string(),
  toInstanceId: z.string(),
  reason: z.enum(['rebalance', 'instance_shutdown', 'instance_failure', 'manual']),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  requestedAt: z.number()
});

export type MigrationRequest = z.infer<typeof MigrationRequestSchema>;

/**
 * Cluster event types
 */
export enum ClusterEventType {
  INSTANCE_REGISTERED = 'instance_registered',
  INSTANCE_UPDATED = 'instance_updated',
  INSTANCE_DIED = 'instance_died',
  GUILD_ASSIGNED = 'guild_assigned',
  GUILD_UNASSIGNED = 'guild_unassigned',
  MIGRATION_STARTED = 'migration_started',
  MIGRATION_COMPLETED = 'migration_completed',
  MIGRATION_FAILED = 'migration_failed',
  REBALANCE_TRIGGERED = 'rebalance_triggered'
}

/**
 * Cluster event message
 */
export const ClusterEventSchema = z.object({
  type: z.nativeEnum(ClusterEventType),
  timestamp: z.number(),
  data: z.record(z.unknown())
});

export type ClusterEvent = z.infer<typeof ClusterEventSchema>;

/**
 * Load balancing strategy
 */
export enum LoadBalancingStrategy {
  LEAST_GUILDS = 'least_guilds',
  LEAST_CPU = 'least_cpu',
  LEAST_MEMORY = 'least_memory',
  ROUND_ROBIN = 'round_robin',
  CONSISTENT_HASH = 'consistent_hash'
}

/**
 * Cluster configuration
 */
export interface ClusterConfig {
  redis: {
    cluster: {
      nodes: Array<{ host: string; port: number }>;
      options?: {
        maxRedirections?: number;
        retryDelayOnFailover?: number;
        enableReadyCheck?: boolean;
      };
    };
    keyPrefix: string;
    ttl: {
      instance: number; // TTL for instance metadata
      heartbeat: number; // TTL for heartbeat
      assignment: number; // TTL for guild assignments
    };
  };
  heartbeat: {
    interval: number; // How often to send heartbeats (ms)
    timeout: number; // When to consider instance dead (ms)
    missedThreshold: number; // Number of missed heartbeats before marking dead
  };
  loadBalancing: {
    strategy: LoadBalancingStrategy;
    rebalanceInterval: number; // How often to check for rebalancing (ms)
    rebalanceThreshold: number; // % difference to trigger rebalance
    maxGuildsPerInstance: number;
  };
  migration: {
    timeout: number; // Max time for a migration (ms)
    retries: number;
    gracePeriod: number; // Time to wait before migrating from dead instance (ms)
  };
  locks: {
    ttl: number; // Lock TTL (ms)
    retryDelay: number;
    retryCount: number;
  };
}

/**
 * Redis keys for cluster data
 */
export const REDIS_KEYS = {
  INSTANCES: 'cluster:instances',
  INSTANCE: (id: string) => `cluster:instance:${id}`,
  HEARTBEAT: (id: string) => `cluster:heartbeat:${id}`,
  GUILDS: 'cluster:guilds',
  GUILD_ASSIGNMENT: (guildId: string) => `cluster:guild:${guildId}`,
  GUILD_LOCK: (guildId: string) => `cluster:lock:guild:${guildId}`,
  INSTANCE_LOCK: (instanceId: string) => `cluster:lock:instance:${instanceId}`,
  MIGRATION: (guildId: string) => `cluster:migration:${guildId}`,
  EVENTS: 'cluster:events',
  AFFINITY: (guildId: string) => `cluster:affinity:${guildId}`
} as const;

/**
 * Redis channels for pub/sub
 */
export const REDIS_CHANNELS = {
  HEARTBEATS: 'cluster:channel:heartbeats',
  EVENTS: 'cluster:channel:events',
  MIGRATIONS: 'cluster:channel:migrations',
  COMMANDS: 'cluster:channel:commands'
} as const;

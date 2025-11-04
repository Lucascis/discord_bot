/**
 * Cluster package exports
 */

export * from './types.js';
export * from './locks.js';
export * from './registry.js';
export * from './affinity.js';
export * from './coordinator.js';

// Re-export commonly used types
export type {
  InstanceMetadata,
  GuildAssignment,
  HeartbeatMessage,
  MigrationRequest,
  ClusterEvent,
  ClusterConfig
} from './types.js';

export {
  ServiceType,
  InstanceStatus,
  LoadBalancingStrategy,
  ClusterEventType,
  REDIS_KEYS,
  REDIS_CHANNELS
} from './types.js';

export { ServiceRegistry } from './registry.js';
export { SessionAffinityManager } from './affinity.js';
export { DistributedLockManager, createLockResource } from './locks.js';
export { ClusterCoordinator } from './coordinator.js';

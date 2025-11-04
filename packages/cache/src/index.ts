export { TTLMap } from './ttl-map.js';
export type { TTLMapOptions, TTLMapEntry } from './ttl-map.js';
export { CircuitBreaker, CircuitBreakerManager, CircuitState } from './circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitBreakerMetrics } from './circuit-breaker.js';
export { RedisCircuitBreaker } from './redis-circuit-breaker.js';
export type { RedisCircuitBreakerConfig } from './redis-circuit-breaker.js';
export {
  MultiLayerCache,
  SearchCache,
  UserCache,
  QueueCache,
  SettingsCache
} from './multi-layer-cache.js';
export type {
  CacheLayerStats,
  MultiLayerCacheConfig,
  CacheEntry
} from './multi-layer-cache.js';
export { RedisStreamsManager, redisStreams } from './redis-streams.js';
export type { StreamMessage, StreamCommandData, StreamResponseData } from './redis-streams.js';
export { RedisStreamsMonitoring, audioStreamsMonitoring, gatewayStreamsMonitoring } from './redis-streams-monitoring.js';
export { RedisClusterClient, createRedisCluster, parseClusterNodes } from './redis-cluster-client.js';
export type { RedisClusterConfig, ClusterNodeStats, ClusterStats, ClusterMetrics } from './redis-cluster-client.js';
export { RedisPoolManager, RedisConnectionPool } from './redis-pool-manager.js';
export type { RedisPoolConfig, PoolConnection } from './redis-pool-manager.js';
// Message Schema Validation Exports
export {
  SCHEMA_VERSION,
  VoiceCredentialsSchema,
  VoiceCredentialsMessageSchema,
  CommandMessageSchema,
  LavalinkEventMessageSchema,
  UIUpdateMessageSchema,
  TrackQueuedMessageSchema,
  DiscordEventMessageSchema,
  GenericMessageSchema,
  validateVoiceCredentials,
  safeValidateVoiceCredentials,
  validateVoiceCredentialsMessage,
  safeValidateVoiceCredentialsMessage,
  validateCommand,
  safeValidateCommand,
  validateLavalinkEvent,
  safeValidateLavalinkEvent,
  validateUIUpdate,
  safeValidateUIUpdate,
  validateTrackQueued,
  safeValidateTrackQueued,
  validateMessage,
  safeValidateMessage
} from './message-schemas.js';
export type {
  VoiceCredentials,
  VoiceCredentialsMessage,
  CommandMessage,
  LavalinkEventMessage,
  UIUpdateMessage,
  TrackQueuedMessage,
  DiscordEventMessage,
  GenericMessage
} from './message-schemas.js';
/**
 * Cluster coordinator for managing service instances, load balancing, and guild assignments
 */

import { Cluster } from 'ioredis';
import { logger } from '@discord-bot/logger';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  InstanceMetadata,
  GuildAssignment,
  HeartbeatMessage,
  MigrationRequest,
  ServiceType,
  InstanceStatus,
  LoadBalancingStrategy,
  ClusterConfig,
  REDIS_KEYS,
  REDIS_CHANNELS,
  ClusterEventType
} from './types.js';
import { ServiceRegistry } from './registry.js';
import { SessionAffinityManager } from './affinity.js';
import { DistributedLockManager, createLockResource } from './locks.js';
import crypto from 'crypto';

const heartbeatsReceivedTotal = new Counter({
  name: 'cluster_heartbeats_received_total',
  help: 'Total number of heartbeats received',
  labelNames: ['instance_id', 'service_type']
});

const missedHeartbeatsTotal = new Counter({
  name: 'cluster_missed_heartbeats_total',
  help: 'Total number of missed heartbeats',
  labelNames: ['instance_id']
});

const migrationsTotal = new Counter({
  name: 'cluster_migrations_total',
  help: 'Total number of guild migrations',
  labelNames: ['reason', 'status']
});

const migrationDuration = new Histogram({
  name: 'cluster_migration_duration_seconds',
  help: 'Duration of guild migrations',
  labelNames: ['reason'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

const loadBalanceOperations = new Counter({
  name: 'cluster_load_balance_operations_total',
  help: 'Total number of load balancing operations',
  labelNames: ['strategy', 'status']
});

/**
 * Cluster coordinator - main orchestrator for the cluster
 */
export class ClusterCoordinator {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private monitorInterval: NodeJS.Timeout | null = null;
  private rebalanceInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(
    private redis: Cluster,
    private registry: ServiceRegistry,
    private affinity: SessionAffinityManager,
    private locks: DistributedLockManager,
    private config: ClusterConfig,
    private currentInstance: InstanceMetadata
  ) {}

  /**
   * Start the coordinator
   */
  async start(): Promise<void> {
    logger.info(
      { instanceId: this.currentInstance.instanceId },
      'Starting cluster coordinator'
    );

    // Register this instance
    await this.registry.registerInstance(this.currentInstance);

    // Start heartbeat
    this.startHeartbeat();

    // Start monitoring other instances
    this.startMonitoring();

    // Start load balancing (only on one instance - elected leader)
    await this.maybeStartRebalancing();

    // Subscribe to cluster events
    await this.subscribeToEvents();

    logger.info('Cluster coordinator started');
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    logger.info('Stopping cluster coordinator');
    this.isShuttingDown = true;

    // Stop intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.rebalanceInterval) clearInterval(this.rebalanceInterval);

    // Update status
    this.currentInstance.status = InstanceStatus.SHUTTING_DOWN;
    await this.registry.updateInstance(this.currentInstance);

    // Migrate guilds if necessary
    await this.migrateInstanceGuilds(
      this.currentInstance.instanceId,
      'instance_shutdown'
    );

    // Deregister
    await this.registry.deregisterInstance(this.currentInstance.instanceId);

    logger.info('Cluster coordinator stopped');
  }

  /**
   * Start sending heartbeats
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        const heartbeat: HeartbeatMessage = {
          instanceId: this.currentInstance.instanceId,
          timestamp: Date.now(),
          status: this.currentInstance.status,
          metrics: {
            guildCount: this.currentInstance.assignedGuilds.length,
            activeVoiceConnections: 0, // Should be provided by caller
            memoryUsage: process.memoryUsage().heapUsed,
            cpuUsage: process.cpuUsage().user,
            uptime: Date.now() - this.currentInstance.startedAt
          }
        };

        // Update last heartbeat
        this.currentInstance.lastHeartbeat = Date.now();

        // Store heartbeat
        await this.redis.setex(
          REDIS_KEYS.HEARTBEAT(this.currentInstance.instanceId),
          this.config.heartbeat.timeout / 1000,
          JSON.stringify(heartbeat)
        );

        // Update instance metadata
        await this.registry.updateInstance(this.currentInstance);

        // Publish heartbeat
        await this.redis.publish(
          REDIS_CHANNELS.HEARTBEATS,
          JSON.stringify(heartbeat)
        );

        heartbeatsReceivedTotal
          .labels(this.currentInstance.instanceId, this.currentInstance.serviceType)
          .inc();
      } catch (error) {
        logger.error({ error }, 'Failed to send heartbeat');
      }
    }, this.config.heartbeat.interval);
  }

  /**
   * Start monitoring other instances
   */
  private startMonitoring(): void {
    this.monitorInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        const instances = await this.registry.getAllInstances();
        const now = Date.now();

        for (const instance of instances) {
          // Skip self
          if (instance.instanceId === this.currentInstance.instanceId) continue;

          // Check if heartbeat is missing
          const timeSinceHeartbeat = now - instance.lastHeartbeat;

          if (timeSinceHeartbeat > this.config.heartbeat.timeout) {
            missedHeartbeatsTotal.labels(instance.instanceId).inc();

            logger.warn(
              { instanceId: instance.instanceId, timeSinceHeartbeat },
              'Instance missed heartbeat'
            );

            // Mark as unhealthy if too many missed
            if (instance.status === InstanceStatus.HEALTHY) {
              instance.status = InstanceStatus.UNHEALTHY;
              await this.registry.updateInstance(instance);
            }

            // If dead threshold reached, handle failure
            const missedCount = Math.floor(
              timeSinceHeartbeat / this.config.heartbeat.interval
            );

            if (missedCount >= this.config.heartbeat.missedThreshold) {
              await this.handleInstanceDeath(instance);
            }
          }
        }
      } catch (error) {
        logger.error({ error }, 'Failed to monitor instances');
      }
    }, this.config.heartbeat.interval);
  }

  /**
   * Handle instance death
   */
  private async handleInstanceDeath(instance: InstanceMetadata): Promise<void> {
    logger.error({ instanceId: instance.instanceId }, 'Instance detected as dead');

    try {
      // Use lock to prevent multiple instances handling same death
      await this.locks.withLock(
        createLockResource.instance(instance.instanceId),
        async () => {
          // Mark as dead
          instance.status = InstanceStatus.DEAD;
          await this.registry.updateInstance(instance);

          // Handle affinity failover
          await this.affinity.handleInstanceFailure(
            instance.instanceId,
            instance.serviceType
          );

          // Migrate guilds
          await this.migrateInstanceGuilds(
            instance.instanceId,
            'instance_failure'
          );

          // Deregister after grace period
          setTimeout(async () => {
            await this.registry.deregisterInstance(instance.instanceId);
          }, this.config.migration.gracePeriod);
        },
        30000 // 30 second lock
      );
    } catch (error) {
      logger.error({ error, instanceId: instance.instanceId }, 'Failed to handle instance death');
    }
  }

  /**
   * Migrate all guilds from an instance
   */
  private async migrateInstanceGuilds(
    fromInstanceId: string,
    reason: MigrationRequest['reason']
  ): Promise<void> {
    try {
      const assignments = await this.registry.getInstanceGuilds(fromInstanceId);

      logger.info(
        { fromInstanceId, guildCount: assignments.length, reason },
        'Migrating guilds from instance'
      );

      for (const assignment of assignments) {
        // Find best target instance
        const targetInstance = await this.selectInstanceForGuild(
          assignment.guildId,
          assignment.serviceType
        );

        if (!targetInstance) {
          logger.warn(
            { guildId: assignment.guildId },
            'No target instance available for migration'
          );
          continue;
        }

        const migrationRequest: MigrationRequest = {
          guildId: assignment.guildId,
          fromInstanceId,
          toInstanceId: targetInstance.instanceId,
          reason,
          priority: assignment.hasVoiceConnection ? 'high' : 'normal',
          requestedAt: Date.now()
        };

        await this.migrateGuild(migrationRequest);
      }
    } catch (error) {
      logger.error({ error, fromInstanceId }, 'Failed to migrate instance guilds');
    }
  }

  /**
   * Migrate a single guild
   */
  async migrateGuild(request: MigrationRequest): Promise<boolean> {
    const startTime = Date.now();

    try {
      await this.locks.withLock(
        createLockResource.migration(request.guildId),
        async () => {
          logger.info({ request }, 'Starting guild migration');

          // Store migration request
          await this.redis.setex(
            REDIS_KEYS.MIGRATION(request.guildId),
            this.config.migration.timeout / 1000,
            JSON.stringify(request)
          );

          // Publish migration event
          await this.redis.publish(
            REDIS_CHANNELS.MIGRATIONS,
            JSON.stringify({
              type: ClusterEventType.MIGRATION_STARTED,
              timestamp: Date.now(),
              data: { request }
            })
          );

          // Remove old affinity
          await this.affinity.removeAffinity(request.guildId);

          // Set new affinity
          const assignment = await this.registry.getGuildAssignment(request.guildId);
          await this.affinity.setAffinity(
            request.guildId,
            request.toInstanceId,
            assignment?.serviceType || ServiceType.GATEWAY,
            assignment?.hasVoiceConnection || false
          );

          // Clean up migration request
          await this.redis.del(REDIS_KEYS.MIGRATION(request.guildId));

          // Publish success event
          await this.redis.publish(
            REDIS_CHANNELS.MIGRATIONS,
            JSON.stringify({
              type: ClusterEventType.MIGRATION_COMPLETED,
              timestamp: Date.now(),
              data: { request }
            })
          );

          migrationsTotal.labels(request.reason, 'success').inc();

          const duration = (Date.now() - startTime) / 1000;
          migrationDuration.labels(request.reason).observe(duration);

          logger.info(
            { guildId: request.guildId, duration },
            'Guild migration completed'
          );
        },
        this.config.migration.timeout
      );

      return true;
    } catch (error) {
      migrationsTotal.labels(request.reason, 'failure').inc();
      logger.error({ error, request }, 'Failed to migrate guild');

      // Publish failure event
      await this.redis.publish(
        REDIS_CHANNELS.MIGRATIONS,
        JSON.stringify({
          type: ClusterEventType.MIGRATION_FAILED,
          timestamp: Date.now(),
          data: { request, error: String(error) }
        })
      );

      return false;
    }
  }

  /**
   * Select best instance for a guild based on load balancing strategy
   */
  async selectInstanceForGuild(
    guildId: string,
    serviceType: ServiceType
  ): Promise<InstanceMetadata | null> {
    const instances = await this.registry.getHealthyInstances(serviceType);

    if (instances.length === 0) return null;

    // Filter out instances at max capacity
    const availableInstances = instances.filter(
      i => i.assignedGuilds.length < this.config.loadBalancing.maxGuildsPerInstance
    );

    if (availableInstances.length === 0) {
      logger.warn('All instances at max capacity');
      return null;
    }

    const strategy = this.config.loadBalancing.strategy;

    switch (strategy) {
      case LoadBalancingStrategy.LEAST_GUILDS:
        return availableInstances.reduce((prev, curr) =>
          prev.assignedGuilds.length < curr.assignedGuilds.length ? prev : curr
        );

      case LoadBalancingStrategy.LEAST_CPU:
        return availableInstances.reduce((prev, curr) =>
          prev.cpuUsage < curr.cpuUsage ? prev : curr
        );

      case LoadBalancingStrategy.LEAST_MEMORY:
        return availableInstances.reduce((prev, curr) =>
          prev.availableMemory > curr.availableMemory ? prev : curr
        );

      case LoadBalancingStrategy.ROUND_ROBIN:
        // Simple round-robin based on guild count
        return availableInstances.reduce((prev, curr) =>
          prev.assignedGuilds.length <= curr.assignedGuilds.length ? prev : curr
        );

      case LoadBalancingStrategy.CONSISTENT_HASH:
        // Consistent hashing based on guild ID
        const hash = crypto
          .createHash('md5')
          .update(guildId)
          .digest('hex');
        const index = parseInt(hash.substring(0, 8), 16) % availableInstances.length;
        return availableInstances[index];

      default:
        return availableInstances[0];
    }
  }

  /**
   * Maybe start rebalancing (leader election)
   */
  private async maybeStartRebalancing(): Promise<void> {
    try {
      // Try to acquire rebalance lock - only one instance should do this
      const lock = await this.locks.tryAcquire(
        createLockResource.rebalance(),
        this.config.loadBalancing.rebalanceInterval * 2
      );

      if (!lock) {
        logger.debug('Another instance is handling rebalancing');
        return;
      }

      logger.info('This instance elected as rebalance leader');

      this.rebalanceInterval = setInterval(async () => {
        if (this.isShuttingDown) return;

        try {
          await this.rebalanceCluster();
        } catch (error) {
          logger.error({ error }, 'Failed to rebalance cluster');
        }
      }, this.config.loadBalancing.rebalanceInterval);
    } catch (error) {
      logger.error({ error }, 'Failed to start rebalancing');
    }
  }

  /**
   * Rebalance cluster load
   */
  private async rebalanceCluster(): Promise<void> {
    try {
      await this.locks.withLock(createLockResource.rebalance(), async () => {
        const instances = await this.registry.getHealthyInstances(
          ServiceType.GATEWAY
        );

        if (instances.length < 2) return; // No point in rebalancing with < 2 instances

        // Calculate average guilds per instance
        const totalGuilds = instances.reduce(
          (sum, i) => sum + i.assignedGuilds.length,
          0
        );
        const avgGuilds = totalGuilds / instances.length;

        // Find overloaded and underloaded instances
        const threshold = this.config.loadBalancing.rebalanceThreshold / 100;
        const overloaded = instances.filter(
          i => i.assignedGuilds.length > avgGuilds * (1 + threshold)
        );
        const underloaded = instances.filter(
          i => i.assignedGuilds.length < avgGuilds * (1 - threshold)
        );

        if (overloaded.length === 0 || underloaded.length === 0) {
          return; // Cluster is balanced
        }

        logger.info(
          { overloaded: overloaded.length, underloaded: underloaded.length, avgGuilds },
          'Rebalancing cluster'
        );

        // Publish rebalance event
        await this.redis.publish(
          REDIS_CHANNELS.EVENTS,
          JSON.stringify({
            type: ClusterEventType.REBALANCE_TRIGGERED,
            timestamp: Date.now(),
            data: { overloaded: overloaded.length, underloaded: underloaded.length }
          })
        );

        // Move guilds from overloaded to underloaded
        for (const source of overloaded) {
          const guildsToMove = Math.floor(
            (source.assignedGuilds.length - avgGuilds) / 2
          );

          if (guildsToMove <= 0) continue;

          const assignments = await this.registry.getInstanceGuilds(
            source.instanceId
          );

          // Only move guilds without active voice connections
          const movableGuilds = assignments
            .filter(a => !a.hasVoiceConnection)
            .slice(0, guildsToMove);

          for (const assignment of movableGuilds) {
            const target = underloaded[0]; // Pick first underloaded

            const request: MigrationRequest = {
              guildId: assignment.guildId,
              fromInstanceId: source.instanceId,
              toInstanceId: target.instanceId,
              reason: 'rebalance',
              priority: 'low',
              requestedAt: Date.now()
            };

            await this.migrateGuild(request);

            // Update target's guild count
            target.assignedGuilds.push(assignment.guildId);

            // Re-sort if needed
            if (target.assignedGuilds.length >= avgGuilds) {
              underloaded.shift();
              if (underloaded.length === 0) break;
            }
          }
        }

        loadBalanceOperations
          .labels(this.config.loadBalancing.strategy, 'success')
          .inc();
      }, 60000); // 60 second lock for rebalancing
    } catch (error) {
      loadBalanceOperations
        .labels(this.config.loadBalancing.strategy, 'failure')
        .inc();
      logger.error({ error }, 'Failed to rebalance cluster');
    }
  }

  /**
   * Subscribe to cluster events
   */
  private async subscribeToEvents(): Promise<void> {
    // Subscribe to all cluster channels
    await this.redis.subscribe(
      REDIS_CHANNELS.EVENTS,
      REDIS_CHANNELS.HEARTBEATS,
      REDIS_CHANNELS.MIGRATIONS
    );

    this.redis.on('message', (channel, message) => {
      this.handleClusterMessage(channel, message);
    });
  }

  /**
   * Handle cluster messages
   */
  private handleClusterMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);

      switch (channel) {
        case REDIS_CHANNELS.EVENTS:
          this.handleClusterEvent(data);
          break;
        case REDIS_CHANNELS.HEARTBEATS:
          this.handleHeartbeat(data);
          break;
        case REDIS_CHANNELS.MIGRATIONS:
          this.handleMigrationEvent(data);
          break;
      }
    } catch (error) {
      logger.error({ error, channel, message }, 'Failed to handle cluster message');
    }
  }

  /**
   * Handle cluster events
   */
  private handleClusterEvent(event: any): void {
    logger.debug({ event }, 'Cluster event received');
    // Additional event handling can be added here
  }

  /**
   * Handle heartbeat messages
   */
  private handleHeartbeat(heartbeat: HeartbeatMessage): void {
    // Track other instances' heartbeats if needed
    if (heartbeat.instanceId !== this.currentInstance.instanceId) {
      heartbeatsReceivedTotal
        .labels(heartbeat.instanceId, 'unknown')
        .inc();
    }
  }

  /**
   * Handle migration events
   */
  private handleMigrationEvent(event: any): void {
    logger.debug({ event }, 'Migration event received');
    // Additional migration event handling can be added here
  }

  /**
   * Assign a guild to this instance
   */
  async assignGuildToSelf(guildId: string): Promise<void> {
    await this.affinity.setAffinity(
      guildId,
      this.currentInstance.instanceId,
      this.currentInstance.serviceType,
      false
    );

    this.currentInstance.assignedGuilds.push(guildId);
    await this.registry.updateInstance(this.currentInstance);
  }

  /**
   * Get cluster health status
   */
  async getClusterHealth() {
    const stats = await this.registry.getClusterStats();
    const affinityStats = await this.affinity.getAffinityStats();

    return {
      ...stats,
      affinity: affinityStats,
      coordinator: {
        instanceId: this.currentInstance.instanceId,
        status: this.currentInstance.status,
        uptime: Date.now() - this.currentInstance.startedAt
      }
    };
  }
}

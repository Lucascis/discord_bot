/**
 * Service registry for tracking instances and their assignments in the cluster
 */

import { Cluster } from 'ioredis';
import { logger } from '@discord-bot/logger';
import { Counter, Gauge } from 'prom-client';
import {
  InstanceMetadata,
  GuildAssignment,
  ServiceType,
  InstanceStatus,
  REDIS_KEYS,
  REDIS_CHANNELS,
  ClusterEventType,
  ClusterEvent
} from './types.js';

const instancesTotal = new Gauge({
  name: 'cluster_instances_total',
  help: 'Total number of instances in the cluster',
  labelNames: ['service_type', 'status']
});

const guildsAssignedTotal = new Gauge({
  name: 'cluster_guilds_assigned_total',
  help: 'Total number of guilds assigned across the cluster',
  labelNames: ['service_type']
});

const registryOperationsTotal = new Counter({
  name: 'cluster_registry_operations_total',
  help: 'Total number of registry operations',
  labelNames: ['operation', 'status']
});

/**
 * Service registry for managing cluster state
 */
export class ServiceRegistry {
  constructor(
    private redis: Cluster,
    private ttl: { instance: number; assignment: number }
  ) {}

  /**
   * Register an instance in the cluster
   */
  async registerInstance(metadata: InstanceMetadata): Promise<void> {
    try {
      const key = REDIS_KEYS.INSTANCE(metadata.instanceId);
      const data = JSON.stringify(metadata);

      // Store instance metadata with TTL
      await this.redis.setex(key, this.ttl.instance, data);

      // Add to instances set
      await this.redis.sadd(REDIS_KEYS.INSTANCES, metadata.instanceId);

      // Update metrics
      instancesTotal
        .labels(metadata.serviceType, metadata.status)
        .inc();

      registryOperationsTotal.labels('register_instance', 'success').inc();

      // Publish event
      await this.publishEvent({
        type: ClusterEventType.INSTANCE_REGISTERED,
        timestamp: Date.now(),
        data: { instance: metadata }
      });

      logger.info(
        { instanceId: metadata.instanceId, serviceType: metadata.serviceType },
        'Instance registered in cluster'
      );
    } catch (error) {
      registryOperationsTotal.labels('register_instance', 'failure').inc();
      logger.error({ error, metadata }, 'Failed to register instance');
      throw error;
    }
  }

  /**
   * Update instance metadata
   */
  async updateInstance(metadata: InstanceMetadata): Promise<void> {
    try {
      const key = REDIS_KEYS.INSTANCE(metadata.instanceId);
      const data = JSON.stringify(metadata);

      await this.redis.setex(key, this.ttl.instance, data);

      registryOperationsTotal.labels('update_instance', 'success').inc();

      // Publish event
      await this.publishEvent({
        type: ClusterEventType.INSTANCE_UPDATED,
        timestamp: Date.now(),
        data: { instance: metadata }
      });
    } catch (error) {
      registryOperationsTotal.labels('update_instance', 'failure').inc();
      logger.error({ error, instanceId: metadata.instanceId }, 'Failed to update instance');
      throw error;
    }
  }

  /**
   * Deregister an instance from the cluster
   */
  async deregisterInstance(instanceId: string): Promise<void> {
    try {
      // Get instance metadata before removing
      const metadata = await this.getInstance(instanceId);

      // Remove from instances set
      await this.redis.srem(REDIS_KEYS.INSTANCES, instanceId);

      // Delete instance metadata
      await this.redis.del(REDIS_KEYS.INSTANCE(instanceId));

      // Delete heartbeat key
      await this.redis.del(REDIS_KEYS.HEARTBEAT(instanceId));

      if (metadata) {
        instancesTotal
          .labels(metadata.serviceType, metadata.status)
          .dec();
      }

      registryOperationsTotal.labels('deregister_instance', 'success').inc();

      // Publish event
      await this.publishEvent({
        type: ClusterEventType.INSTANCE_DIED,
        timestamp: Date.now(),
        data: { instanceId, instance: metadata }
      });

      logger.info({ instanceId }, 'Instance deregistered from cluster');
    } catch (error) {
      registryOperationsTotal.labels('deregister_instance', 'failure').inc();
      logger.error({ error, instanceId }, 'Failed to deregister instance');
      throw error;
    }
  }

  /**
   * Get instance metadata
   */
  async getInstance(instanceId: string): Promise<InstanceMetadata | null> {
    try {
      const data = await this.redis.get(REDIS_KEYS.INSTANCE(instanceId));
      if (!data) return null;

      return JSON.parse(data) as InstanceMetadata;
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to get instance');
      return null;
    }
  }

  /**
   * Get all instances
   */
  async getAllInstances(): Promise<InstanceMetadata[]> {
    try {
      const instanceIds = await this.redis.smembers(REDIS_KEYS.INSTANCES);
      const instances: InstanceMetadata[] = [];

      for (const id of instanceIds) {
        const instance = await this.getInstance(id);
        if (instance) {
          instances.push(instance);
        }
      }

      return instances;
    } catch (error) {
      logger.error({ error }, 'Failed to get all instances');
      return [];
    }
  }

  /**
   * Get instances by service type
   */
  async getInstancesByType(serviceType: ServiceType): Promise<InstanceMetadata[]> {
    const allInstances = await this.getAllInstances();
    return allInstances.filter(i => i.serviceType === serviceType);
  }

  /**
   * Get healthy instances by service type
   */
  async getHealthyInstances(serviceType: ServiceType): Promise<InstanceMetadata[]> {
    const instances = await this.getInstancesByType(serviceType);
    return instances.filter(i => i.status === InstanceStatus.HEALTHY);
  }

  /**
   * Assign a guild to an instance
   */
  async assignGuild(assignment: GuildAssignment): Promise<void> {
    try {
      const key = REDIS_KEYS.GUILD_ASSIGNMENT(assignment.guildId);
      const data = JSON.stringify(assignment);

      await this.redis.setex(key, this.ttl.assignment, data);
      await this.redis.hset(REDIS_KEYS.GUILDS, assignment.guildId, assignment.instanceId);

      guildsAssignedTotal.labels(assignment.serviceType).inc();
      registryOperationsTotal.labels('assign_guild', 'success').inc();

      // Publish event
      await this.publishEvent({
        type: ClusterEventType.GUILD_ASSIGNED,
        timestamp: Date.now(),
        data: { assignment }
      });

      logger.debug(
        { guildId: assignment.guildId, instanceId: assignment.instanceId },
        'Guild assigned to instance'
      );
    } catch (error) {
      registryOperationsTotal.labels('assign_guild', 'failure').inc();
      logger.error({ error, assignment }, 'Failed to assign guild');
      throw error;
    }
  }

  /**
   * Unassign a guild from an instance
   */
  async unassignGuild(guildId: string): Promise<void> {
    try {
      const assignment = await this.getGuildAssignment(guildId);

      await this.redis.del(REDIS_KEYS.GUILD_ASSIGNMENT(guildId));
      await this.redis.hdel(REDIS_KEYS.GUILDS, guildId);

      if (assignment) {
        guildsAssignedTotal.labels(assignment.serviceType).dec();
      }

      registryOperationsTotal.labels('unassign_guild', 'success').inc();

      // Publish event
      await this.publishEvent({
        type: ClusterEventType.GUILD_UNASSIGNED,
        timestamp: Date.now(),
        data: { guildId, assignment }
      });

      logger.debug({ guildId }, 'Guild unassigned');
    } catch (error) {
      registryOperationsTotal.labels('unassign_guild', 'failure').inc();
      logger.error({ error, guildId }, 'Failed to unassign guild');
      throw error;
    }
  }

  /**
   * Get guild assignment
   */
  async getGuildAssignment(guildId: string): Promise<GuildAssignment | null> {
    try {
      const data = await this.redis.get(REDIS_KEYS.GUILD_ASSIGNMENT(guildId));
      if (!data) return null;

      return JSON.parse(data) as GuildAssignment;
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get guild assignment');
      return null;
    }
  }

  /**
   * Get all guild assignments for an instance
   */
  async getInstanceGuilds(instanceId: string): Promise<GuildAssignment[]> {
    try {
      const allGuilds = await this.redis.hgetall(REDIS_KEYS.GUILDS);
      const assignments: GuildAssignment[] = [];

      for (const [guildId, assignedInstanceId] of Object.entries(allGuilds)) {
        if (assignedInstanceId === instanceId) {
          const assignment = await this.getGuildAssignment(guildId);
          if (assignment) {
            assignments.push(assignment);
          }
        }
      }

      return assignments;
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to get instance guilds');
      return [];
    }
  }

  /**
   * Update guild assignment's last activity
   */
  async updateGuildActivity(guildId: string): Promise<void> {
    try {
      const assignment = await this.getGuildAssignment(guildId);
      if (!assignment) return;

      assignment.lastActivity = Date.now();
      await this.assignGuild(assignment);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to update guild activity');
    }
  }

  /**
   * Publish cluster event
   */
  private async publishEvent(event: ClusterEvent): Promise<void> {
    try {
      await this.redis.publish(REDIS_CHANNELS.EVENTS, JSON.stringify(event));
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish cluster event');
    }
  }

  /**
   * Get cluster statistics
   */
  async getClusterStats() {
    const instances = await this.getAllInstances();
    const allGuilds = await this.redis.hgetall(REDIS_KEYS.GUILDS);

    const stats = {
      totalInstances: instances.length,
      instancesByType: {} as Record<ServiceType, number>,
      instancesByStatus: {} as Record<InstanceStatus, number>,
      totalGuilds: Object.keys(allGuilds).length,
      avgGuildsPerInstance: 0,
      healthyInstances: instances.filter(i => i.status === InstanceStatus.HEALTHY).length
    };

    // Count by type and status
    for (const instance of instances) {
      stats.instancesByType[instance.serviceType] =
        (stats.instancesByType[instance.serviceType] || 0) + 1;
      stats.instancesByStatus[instance.status] =
        (stats.instancesByStatus[instance.status] || 0) + 1;
    }

    if (stats.totalInstances > 0) {
      stats.avgGuildsPerInstance = stats.totalGuilds / stats.totalInstances;
    }

    return stats;
  }
}

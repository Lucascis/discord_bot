/**
 * Session affinity manager for maintaining voice connections on the same instance
 */

import { Cluster } from 'ioredis';
import { logger } from '@discord-bot/logger';
import { Counter, Histogram } from 'prom-client';
import {
  ServiceType,
  GuildAssignment,
  REDIS_KEYS,
  REDIS_CHANNELS
} from './types.js';
import { ServiceRegistry } from './registry.js';
import { DistributedLockManager, createLockResource } from './locks.js';

const affinityRoutingTotal = new Counter({
  name: 'cluster_affinity_routing_total',
  help: 'Total number of affinity routing operations',
  labelNames: ['operation', 'status', 'has_affinity']
});

const affinityLookupDuration = new Histogram({
  name: 'cluster_affinity_lookup_duration_seconds',
  help: 'Duration of affinity lookups',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

export interface AffinityConfig {
  ttl: number; // How long to maintain affinity (ms)
  stickyness: 'strict' | 'preferred'; // strict = always same instance, preferred = try but allow failover
  retryAttempts: number;
}

/**
 * Affinity record for tracking guild-instance relationships
 */
interface AffinityRecord {
  guildId: string;
  instanceId: string;
  serviceType: ServiceType;
  hasVoiceConnection: boolean;
  createdAt: number;
  lastUsed: number;
  useCount: number;
}

/**
 * Session affinity manager for routing commands to the correct instance
 */
export class SessionAffinityManager {
  constructor(
    private redis: Cluster,
    private registry: ServiceRegistry,
    private locks: DistributedLockManager,
    private config: AffinityConfig
  ) {}

  /**
   * Get or create affinity for a guild
   */
  async getAffinity(
    guildId: string,
    serviceType: ServiceType
  ): Promise<string | null> {
    const startTime = Date.now();

    try {
      // Check existing assignment first
      const assignment = await this.registry.getGuildAssignment(guildId);
      if (assignment && assignment.serviceType === serviceType) {
        const instance = await this.registry.getInstance(assignment.instanceId);

        // If instance is healthy, use it
        if (instance && instance.status === 'healthy') {
          await this.updateAffinityUsage(guildId);
          affinityRoutingTotal.labels('get', 'success', 'true').inc();

          const duration = (Date.now() - startTime) / 1000;
          affinityLookupDuration.observe(duration);

          return assignment.instanceId;
        }
      }

      // No valid affinity found
      affinityRoutingTotal.labels('get', 'success', 'false').inc();

      const duration = (Date.now() - startTime) / 1000;
      affinityLookupDuration.observe(duration);

      return null;
    } catch (error) {
      affinityRoutingTotal.labels('get', 'failure', 'false').inc();
      logger.error({ error, guildId, serviceType }, 'Failed to get affinity');
      return null;
    }
  }

  /**
   * Set affinity for a guild to a specific instance
   */
  async setAffinity(
    guildId: string,
    instanceId: string,
    serviceType: ServiceType,
    hasVoiceConnection = false
  ): Promise<void> {
    try {
      // Use lock to prevent race conditions
      await this.locks.withLock(createLockResource.guild(guildId), async () => {
        const key = REDIS_KEYS.AFFINITY(guildId);
        const record: AffinityRecord = {
          guildId,
          instanceId,
          serviceType,
          hasVoiceConnection,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          useCount: 1
        };

        await this.redis.setex(key, this.config.ttl, JSON.stringify(record));

        // Also update registry assignment
        const assignment: GuildAssignment = {
          guildId,
          instanceId,
          serviceType,
          assignedAt: Date.now(),
          lastActivity: Date.now(),
          hasVoiceConnection,
          playerActive: hasVoiceConnection
        };

        await this.registry.assignGuild(assignment);

        affinityRoutingTotal.labels('set', 'success', 'true').inc();

        logger.debug(
          { guildId, instanceId, serviceType, hasVoiceConnection },
          'Affinity set for guild'
        );
      });
    } catch (error) {
      affinityRoutingTotal.labels('set', 'failure', 'true').inc();
      logger.error(
        { error, guildId, instanceId, serviceType },
        'Failed to set affinity'
      );
      throw error;
    }
  }

  /**
   * Update affinity when guild is actively used
   */
  async updateAffinityUsage(guildId: string): Promise<void> {
    try {
      const key = REDIS_KEYS.AFFINITY(guildId);
      const data = await this.redis.get(key);

      if (!data) return;

      const record: AffinityRecord = JSON.parse(data);
      record.lastUsed = Date.now();
      record.useCount++;

      await this.redis.setex(key, this.config.ttl, JSON.stringify(record));
      await this.registry.updateGuildActivity(guildId);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to update affinity usage');
    }
  }

  /**
   * Mark that a guild has an active voice connection
   */
  async markVoiceConnection(guildId: string, active: boolean): Promise<void> {
    try {
      await this.locks.withLock(createLockResource.guild(guildId), async () => {
        const key = REDIS_KEYS.AFFINITY(guildId);
        const data = await this.redis.get(key);

        if (!data) return;

        const record: AffinityRecord = JSON.parse(data);
        record.hasVoiceConnection = active;
        record.lastUsed = Date.now();

        await this.redis.setex(key, this.config.ttl, JSON.stringify(record));

        // Update assignment
        const assignment = await this.registry.getGuildAssignment(guildId);
        if (assignment) {
          assignment.hasVoiceConnection = active;
          assignment.playerActive = active;
          assignment.lastActivity = Date.now();
          await this.registry.assignGuild(assignment);
        }

        logger.debug(
          { guildId, active },
          'Voice connection status updated'
        );
      });
    } catch (error) {
      logger.error({ error, guildId, active }, 'Failed to mark voice connection');
    }
  }

  /**
   * Remove affinity for a guild
   */
  async removeAffinity(guildId: string): Promise<void> {
    try {
      await this.locks.withLock(createLockResource.guild(guildId), async () => {
        await this.redis.del(REDIS_KEYS.AFFINITY(guildId));
        await this.registry.unassignGuild(guildId);

        affinityRoutingTotal.labels('remove', 'success', 'false').inc();

        logger.debug({ guildId }, 'Affinity removed for guild');
      });
    } catch (error) {
      affinityRoutingTotal.labels('remove', 'failure', 'false').inc();
      logger.error({ error, guildId }, 'Failed to remove affinity');
      throw error;
    }
  }

  /**
   * Route a command to the correct instance based on affinity
   */
  async routeCommand(
    guildId: string,
    serviceType: ServiceType,
    command: unknown
  ): Promise<string | null> {
    try {
      // Try to get existing affinity
      let instanceId = await this.getAffinity(guildId, serviceType);

      // If no affinity and config is preferred (not strict), allow any healthy instance
      if (!instanceId && this.config.stickyness === 'preferred') {
        const instances = await this.registry.getHealthyInstances(serviceType);
        if (instances.length > 0) {
          // Pick the instance with least guilds
          instanceId = instances.reduce((prev, curr) =>
            prev.assignedGuilds.length < curr.assignedGuilds.length ? prev : curr
          ).instanceId;
        }
      }

      if (!instanceId) {
        logger.warn({ guildId, serviceType }, 'No instance available for routing');
        return null;
      }

      // Publish command to specific instance
      const channel = `${REDIS_CHANNELS.COMMANDS}:${instanceId}`;
      await this.redis.publish(channel, JSON.stringify({ guildId, command }));

      logger.debug(
        { guildId, instanceId, serviceType },
        'Command routed to instance'
      );

      return instanceId;
    } catch (error) {
      logger.error({ error, guildId, serviceType }, 'Failed to route command');
      return null;
    }
  }

  /**
   * Handle instance failure - migrate affected guilds
   */
  async handleInstanceFailure(
    failedInstanceId: string,
    serviceType: ServiceType
  ): Promise<void> {
    try {
      logger.warn({ failedInstanceId, serviceType }, 'Handling instance failure');

      // Get all guilds assigned to failed instance
      const assignments = await this.registry.getInstanceGuilds(failedInstanceId);

      for (const assignment of assignments) {
        // Skip if different service type
        if (assignment.serviceType !== serviceType) continue;

        // If has voice connection and stickyness is strict, keep affinity
        // but mark for migration when instance comes back
        if (assignment.hasVoiceConnection && this.config.stickyness === 'strict') {
          logger.info(
            { guildId: assignment.guildId, failedInstanceId },
            'Keeping affinity for guild with voice connection (strict mode)'
          );
          continue;
        }

        // Remove affinity to allow reassignment
        await this.removeAffinity(assignment.guildId);

        logger.info(
          { guildId: assignment.guildId, failedInstanceId },
          'Affinity removed due to instance failure'
        );
      }

      affinityRoutingTotal.labels('failover', 'success', 'true').inc();
    } catch (error) {
      affinityRoutingTotal.labels('failover', 'failure', 'true').inc();
      logger.error({ error, failedInstanceId }, 'Failed to handle instance failure');
      throw error;
    }
  }

  /**
   * Get affinity statistics
   */
  async getAffinityStats() {
    try {
      const pattern = REDIS_KEYS.AFFINITY('*');
      const keys = await this.redis.keys(pattern);

      let totalAffinities = 0;
      let withVoiceConnection = 0;
      const byServiceType: Record<string, number> = {};

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (!data) continue;

        const record: AffinityRecord = JSON.parse(data);
        totalAffinities++;

        if (record.hasVoiceConnection) {
          withVoiceConnection++;
        }

        byServiceType[record.serviceType] =
          (byServiceType[record.serviceType] || 0) + 1;
      }

      return {
        totalAffinities,
        withVoiceConnection,
        withoutVoiceConnection: totalAffinities - withVoiceConnection,
        byServiceType
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get affinity stats');
      return {
        totalAffinities: 0,
        withVoiceConnection: 0,
        withoutVoiceConnection: 0,
        byServiceType: {}
      };
    }
  }
}

import { logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import type { Player, Track } from 'lavalink-client';
import { queueCache } from './cache.js';

// Connection pool for Redis operations
const redisPoolSize = 0;
const maxRedisConnections = 10;

export function getRedisConnectionMetrics() {
  return { current: redisPoolSize, max: maxRedisConnections };
}

/**
 * Batch Queue Saver - High-Performance Database Write Optimization
 * 
 * This class implements a sophisticated batching system to dramatically reduce
 * database write operations for queue state updates. Instead of writing to the
 * database on every queue change, it batches multiple updates together.
 * 
 * Performance Benefits:
 * - Reduces database writes from potentially hundreds per second to batches every 1s
 * - Prevents database connection pool exhaustion during high activity
 * - Automatically deduplicates multiple updates for the same guild
 * - Implements controlled concurrency to prevent overwhelming the database
 * 
 * Architecture:
 * 1. Immediate updates are collected in memory with timestamps
 * 2. A single timer batches all pending updates after 1 second
 * 3. Updates are processed in parallel with concurrency limits (5 concurrent operations)
 * 4. Failed updates are logged but don't block other guild updates
 * 5. Cache invalidation ensures consistency with read operations
 */
class BatchQueueSaver {
  // Map of guildId -> pending update data with deduplication
  private pendingUpdates = new Map<string, {
    player: Player;
    voiceChannelId?: string;
    textChannelId?: string;
    timestamp: number;
  }>();
  private batchTimeout?: NodeJS.Timeout | undefined;
  private readonly batchDelay = 1000; // 1 second batching window for optimal balance
  
  scheduleUpdate(guildId: string, player: Player, voiceChannelId?: string, textChannelId?: string): void {
    const updateData: { player: Player; voiceChannelId?: string; textChannelId?: string; timestamp: number } = {
      player,
      timestamp: Date.now()
    };
    
    if (voiceChannelId !== undefined) {
      updateData.voiceChannelId = voiceChannelId;
    }
    
    if (textChannelId !== undefined) {
      updateData.textChannelId = textChannelId;
    }
    
    this.pendingUpdates.set(guildId, updateData);
    
    // Schedule batch processing
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => this.processBatch(), this.batchDelay);
    }
  }
  
  private async processBatch(): Promise<void> {
    const updates = Array.from(this.pendingUpdates.entries());
    this.pendingUpdates.clear();
    this.batchTimeout = undefined;
    
    if (updates.length === 0) return;
    
    logger.debug({ count: updates.length }, 'Processing batched queue updates');
    
    try {
      // Process updates in parallel with concurrency limit
      const concurrencyLimit = 5;
      const chunks = [];
      for (let i = 0; i < updates.length; i += concurrencyLimit) {
        chunks.push(updates.slice(i, i + concurrencyLimit));
      }
      
      for (const chunk of chunks) {
        await Promise.all(chunk.map(([guildId, data]) => 
          this.saveQueueInternal(guildId, data.player, data.voiceChannelId, data.textChannelId)
        ));
      }
      
      logger.debug({ processed: updates.length }, 'Batch queue update completed');
    } catch (error) {
      logger.error({ error, count: updates.length }, 'Batch queue update failed');
    }
  }
  
  private async saveQueueInternal(
    guildId: string, 
    player: Player, 
    voiceChannelId?: string, 
    textChannelId?: string
  ): Promise<void> {
    try {
      // Find or create queue for guild
      let queue = await prisma.queue.findFirst({ 
        where: { guildId }, 
        select: { id: true } 
      });
      
      if (!queue) {
        queue = await prisma.queue.create({ 
          data: { guildId, voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null }, 
          select: { id: true } 
        });
      } else {
        await prisma.queue.update({ 
          where: { id: queue.id }, 
          data: { voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null } 
        });
      }

      // Ensure queue has id property after creation/update
      const queueWithId = queue as { id: string };

      // Clear and rebuild queue items
      await prisma.queueItem.deleteMany({ where: { queueId: queueWithId.id } });
      
      const items: Array<{
        title: string;
        url: string;
        requestedBy: string;
        duration: number;
        queueId: string;
      }> = [];
      
      // Add current track
      const current = player.queue.current as Track | null;
      if (current?.info?.uri) {
        items.push({
          title: current.info.title ?? 'Unknown',
          url: current.info.uri,
          requestedBy: (current.requester as { id?: string })?.id ?? 'unknown',
          duration: Math.floor((current.info.duration ?? 0) / 1000),
          queueId: queueWithId.id
        });
      }
      
      // Add queue tracks
      for (const track of player.queue.tracks as Track[]) {
        if (!track.info?.uri) continue;
        items.push({
          title: track.info.title ?? 'Unknown',
          url: track.info.uri,
          requestedBy: (track.requester as { id?: string })?.id ?? 'unknown',
          duration: Math.floor((track.info.duration ?? 0) / 1000),
          queueId: queueWithId.id
        });
      }
      
      // Use batch insert for better performance
      if (items.length > 0) {
        await prisma.queueItem.createMany({ data: items });
      }
      
      // Invalidate cache after queue update
      queueCache.delete(`queue:${guildId}`);
      
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to save queue');
    }
  }
  
  // Force flush for critical updates
  async flush(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }
    await this.processBatch();
  }
}

export const batchQueueSaver = new BatchQueueSaver();

// Memory usage monitoring and cleanup
export class MemoryManager {
  private static instance: MemoryManager;
  private monitoringInterval?: NodeJS.Timeout | undefined;
  private memoryThreshold = 1024 * 1024 * 1024; // 1GB threshold
  
  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }
  
  startMonitoring(intervalMs = 30000): void {
    if (this.monitoringInterval) return;
    
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);
    
    logger.info('Memory monitoring started');
  }
  
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.info('Memory monitoring stopped');
    }
  }
  
  private checkMemoryUsage(): void {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const rssMB = usage.rss / 1024 / 1024;
    
    if (usage.heapUsed > this.memoryThreshold) {
      logger.warn({ 
        heapUsed: `${heapUsedMB.toFixed(2)}MB`,
        rss: `${rssMB.toFixed(2)}MB`,
        external: `${(usage.external / 1024 / 1024).toFixed(2)}MB`
      }, 'High memory usage detected');
      
      // Trigger garbage collection if available
      if (global.gc) {
        global.gc();
        logger.info('Forced garbage collection');
      }
    }
  }
  
  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024)
    };
  }
}

// Performance metrics tracking
export class PerformanceTracker {
  private static metrics = new Map<string, {
    totalTime: number;
    count: number;
    minTime: number;
    maxTime: number;
  }>();
  
  static async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.recordTiming(operation, Date.now() - start);
      return result;
    } catch (error) {
      this.recordTiming(operation, Date.now() - start);
      throw error;
    }
  }
  
  static measureSync<T>(operation: string, fn: () => T): T {
    const start = Date.now();
    try {
      const result = fn();
      this.recordTiming(operation, Date.now() - start);
      return result;
    } catch (error) {
      this.recordTiming(operation, Date.now() - start);
      throw error;
    }
  }
  
  private static recordTiming(operation: string, duration: number): void {
    const existing = this.metrics.get(operation);
    
    if (existing) {
      existing.totalTime += duration;
      existing.count += 1;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
    } else {
      this.metrics.set(operation, {
        totalTime: duration,
        count: 1,
        minTime: duration,
        maxTime: duration
      });
    }
  }
  
  static getMetrics(): Record<string, {
    avgTime: number;
    count: number;
    minTime: number;
    maxTime: number;
  }> {
    const result: Record<string, {
      avgTime: number;
      count: number;
      minTime: number;
      maxTime: number;
    }> = {};
    
    for (const [operation, data] of this.metrics.entries()) {
      result[operation] = {
        avgTime: Math.round(data.totalTime / data.count),
        count: data.count,
        minTime: data.minTime,
        maxTime: data.maxTime
      };
    }
    
    return result;
  }
  
  static reset(): void {
    this.metrics.clear();
  }
}

// Concurrency control for search operations
export class SearchThrottler {
  private static concurrentSearches = 0;
  private static readonly maxConcurrentSearches = 5;
  private static readonly waitingQueue: Array<() => void> = [];
  
  static async throttle<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for available slot
    await new Promise<void>((resolve) => {
      if (this.concurrentSearches < this.maxConcurrentSearches) {
        this.concurrentSearches++;
        resolve();
      } else {
        this.waitingQueue.push(() => {
          this.concurrentSearches++;
          resolve();
        });
      }
    });
    
    try {
      return await fn();
    } finally {
      this.concurrentSearches--;
      
      // Release next waiting operation
      const next = this.waitingQueue.shift();
      if (next) next();
    }
  }
  
  static getStats() {
    return {
      concurrent: this.concurrentSearches,
      waiting: this.waitingQueue.length,
      maxConcurrent: this.maxConcurrentSearches
    };
  }
  
  static reset(): void {
    this.concurrentSearches = 0;
    this.waitingQueue.length = 0;
  }
}
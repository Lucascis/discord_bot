/**
 * Load Test: Concurrent Guilds
 *
 * Purpose: Validates system performance under high concurrent guild load
 * Scope: Tests 100-1000 guilds with simultaneous music playback
 * Metrics: Response time, throughput, memory usage, error rate
 *
 * @group load
 * @group performance
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { performance } from 'perf_hooks';

// Test configuration
const LOAD_TEST_TIMEOUT = 600000; // 10 minutes
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/discord_test';

// Load test parameters
const GUILD_COUNTS = {
  SMALL: 10,
  MEDIUM: 100,
  LARGE: 1000,
};

const PERFORMANCE_TARGETS = {
  P50_LATENCY_MS: 50,   // 50ms for 50th percentile
  P95_LATENCY_MS: 200,  // 200ms for 95th percentile
  P99_LATENCY_MS: 500,  // 500ms for 99th percentile
  ERROR_RATE: 0.01,      // Max 1% error rate
  THROUGHPUT_MIN: 100,   // Min 100 req/s
};

interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencies: number[];
  startTime: number;
  endTime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

describe.skip('Load Test: Concurrent Guilds (requires full infrastructure)', () => {
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: DATABASE_URL,
        },
      },
    });

    redis = new Redis(REDIS_URL);

    // Cleanup test data
    await prisma.queue.deleteMany({
      where: {
        guildId: {
          startsWith: 'load-test-',
        },
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.queue.deleteMany({
      where: {
        guildId: {
          startsWith: 'load-test-',
        },
      },
    });

    await prisma.$disconnect();
    await redis.quit();
  });

  describe('Small Scale Load (10 guilds)', () => {
    it('should handle 10 concurrent guilds with low latency', async () => {
      const guildCount = GUILD_COUNTS.SMALL;
      const metrics = await runConcurrentGuildTest(guildCount, prisma, redis);

      // Assert performance targets
      expect(metrics.successfulRequests).toBe(guildCount);
      expect(metrics.failedRequests).toBe(0);

      const p95 = calculatePercentile(metrics.latencies, 95);
      expect(p95).toBeLessThan(PERFORMANCE_TARGETS.P95_LATENCY_MS);

      console.log(`Small Scale Test Results (${guildCount} guilds):`, {
        p50: calculatePercentile(metrics.latencies, 50).toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: calculatePercentile(metrics.latencies, 99).toFixed(2) + 'ms',
        throughput: calculateThroughput(metrics).toFixed(2) + ' req/s',
        errorRate: calculateErrorRate(metrics).toFixed(4),
      });
    }, LOAD_TEST_TIMEOUT);
  });

  describe('Medium Scale Load (100 guilds)', () => {
    it('should handle 100 concurrent guilds within performance targets', async () => {
      const guildCount = GUILD_COUNTS.MEDIUM;
      const metrics = await runConcurrentGuildTest(guildCount, prisma, redis);

      // Assert performance targets
      const errorRate = calculateErrorRate(metrics);
      expect(errorRate).toBeLessThan(PERFORMANCE_TARGETS.ERROR_RATE);

      const p95 = calculatePercentile(metrics.latencies, 95);
      expect(p95).toBeLessThan(PERFORMANCE_TARGETS.P95_LATENCY_MS);

      const p99 = calculatePercentile(metrics.latencies, 99);
      expect(p99).toBeLessThan(PERFORMANCE_TARGETS.P99_LATENCY_MS);

      const throughput = calculateThroughput(metrics);
      expect(throughput).toBeGreaterThan(PERFORMANCE_TARGETS.THROUGHPUT_MIN);

      console.log(`Medium Scale Test Results (${guildCount} guilds):`, {
        successful: metrics.successfulRequests,
        failed: metrics.failedRequests,
        p50: calculatePercentile(metrics.latencies, 50).toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: p99.toFixed(2) + 'ms',
        throughput: throughput.toFixed(2) + ' req/s',
        errorRate: errorRate.toFixed(4),
        memoryMB: (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
      });
    }, LOAD_TEST_TIMEOUT);

    it('should handle 100 guilds with continuous operations', async () => {
      const guildCount = GUILD_COUNTS.MEDIUM;
      const operationsPerGuild = 10; // 10 operations per guild

      const metrics = await runContinuousOperationsTest(
        guildCount,
        operationsPerGuild,
        prisma,
        redis
      );

      // Assert
      const totalOperations = guildCount * operationsPerGuild;
      const successRate = metrics.successfulRequests / totalOperations;
      expect(successRate).toBeGreaterThan(0.99); // 99% success rate

      const p95 = calculatePercentile(metrics.latencies, 95);
      expect(p95).toBeLessThan(PERFORMANCE_TARGETS.P95_LATENCY_MS * 1.5); // Allow 50% more latency for continuous ops

      console.log(`Continuous Operations Test Results (${guildCount} guilds × ${operationsPerGuild} ops):`, {
        totalOps: totalOperations,
        successful: metrics.successfulRequests,
        failed: metrics.failedRequests,
        successRate: (successRate * 100).toFixed(2) + '%',
        p50: calculatePercentile(metrics.latencies, 50).toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        throughput: calculateThroughput(metrics).toFixed(2) + ' req/s',
      });
    }, LOAD_TEST_TIMEOUT);
  });

  describe('Large Scale Load (1000 guilds)', () => {
    it('should handle 1000 concurrent guilds with acceptable degradation', async () => {
      const guildCount = GUILD_COUNTS.LARGE;
      const metrics = await runConcurrentGuildTest(guildCount, prisma, redis);

      // Assert - Allow for some degradation at scale
      const errorRate = calculateErrorRate(metrics);
      expect(errorRate).toBeLessThan(PERFORMANCE_TARGETS.ERROR_RATE * 2); // Allow 2% error rate at 1000 guilds

      const p95 = calculatePercentile(metrics.latencies, 95);
      expect(p95).toBeLessThan(PERFORMANCE_TARGETS.P95_LATENCY_MS * 2); // Allow 2x latency at scale

      const p99 = calculatePercentile(metrics.latencies, 99);
      expect(p99).toBeLessThan(PERFORMANCE_TARGETS.P99_LATENCY_MS * 2);

      console.log(`Large Scale Test Results (${guildCount} guilds):`, {
        successful: metrics.successfulRequests,
        failed: metrics.failedRequests,
        p50: calculatePercentile(metrics.latencies, 50).toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: p99.toFixed(2) + 'ms',
        max: Math.max(...metrics.latencies).toFixed(2) + 'ms',
        throughput: calculateThroughput(metrics).toFixed(2) + ' req/s',
        errorRate: (errorRate * 100).toFixed(2) + '%',
        memoryMB: (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
      });
    }, LOAD_TEST_TIMEOUT);

    it('should not exceed memory limits under sustained load', async () => {
      const guildCount = GUILD_COUNTS.LARGE;
      const initialMemory = process.memoryUsage();

      const metrics = await runConcurrentGuildTest(guildCount, prisma, redis);

      const memoryIncreaseMB = (metrics.memoryUsage.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      const memoryPerGuildKB = (memoryIncreaseMB * 1024) / guildCount;

      // Assert reasonable memory usage
      expect(memoryPerGuildKB).toBeLessThan(100); // Less than 100KB per guild

      console.log('Memory Usage Analysis:', {
        initialMB: (initialMemory.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        finalMB: (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
        increaseMB: memoryIncreaseMB.toFixed(2) + 'MB',
        perGuildKB: memoryPerGuildKB.toFixed(2) + 'KB',
      });
    }, LOAD_TEST_TIMEOUT);
  });

  describe('Queue Operations at Scale', () => {
    it('should handle bulk queue insertions efficiently', async () => {
      const guildCount = 100;
      const songsPerGuild = 50;
      const startTime = performance.now();

      // Create guilds with 50 songs each
      const insertPromises = [];
      for (let i = 0; i < guildCount; i++) {
        const guildId = `load-test-queue-${i}`;
        const songs = Array.from({ length: songsPerGuild }, (_, j) => ({
          guildId,
          title: `Song ${j}`,
          author: `Artist ${j}`,
          url: `https://youtube.com/watch?v=test${i}-${j}`,
          duration: 180000,
          position: j,
          addedBy: 'load-test-user',
        }));

        insertPromises.push(
          prisma.queue.createMany({ data: songs })
        );
      }

      await Promise.all(insertPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert
      const totalSongs = guildCount * songsPerGuild;
      const insertsPerSecond = (totalSongs / duration) * 1000;

      expect(insertsPerSecond).toBeGreaterThan(100); // At least 100 inserts/s

      console.log('Bulk Insert Performance:', {
        totalSongs,
        durationMs: duration.toFixed(2) + 'ms',
        insertsPerSecond: insertsPerSecond.toFixed(2),
      });

      // Cleanup
      await prisma.queue.deleteMany({
        where: {
          guildId: {
            startsWith: 'load-test-queue-',
          },
        },
      });
    }, LOAD_TEST_TIMEOUT);

    it('should handle bulk queue queries efficiently', async () => {
      const guildCount = 100;
      const songsPerGuild = 50;

      // Setup: Create queues
      for (let i = 0; i < guildCount; i++) {
        const guildId = `load-test-query-${i}`;
        const songs = Array.from({ length: songsPerGuild }, (_, j) => ({
          guildId,
          title: `Song ${j}`,
          author: `Artist ${j}`,
          url: `https://youtube.com/watch?v=test${i}-${j}`,
          duration: 180000,
          position: j,
          addedBy: 'load-test-user',
        }));

        await prisma.queue.createMany({ data: songs });
      }

      // Test: Query all queues concurrently
      const startTime = performance.now();
      const queryPromises = [];

      for (let i = 0; i < guildCount; i++) {
        const guildId = `load-test-query-${i}`;
        queryPromises.push(
          prisma.queue.findMany({
            where: { guildId },
            orderBy: { position: 'asc' },
          })
        );
      }

      const results = await Promise.all(queryPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert
      expect(results).toHaveLength(guildCount);
      results.forEach(queue => {
        expect(queue).toHaveLength(songsPerGuild);
      });

      const queriesPerSecond = (guildCount / duration) * 1000;
      expect(queriesPerSecond).toBeGreaterThan(10); // At least 10 queries/s

      console.log('Bulk Query Performance:', {
        guilds: guildCount,
        songsPerGuild,
        durationMs: duration.toFixed(2) + 'ms',
        queriesPerSecond: queriesPerSecond.toFixed(2),
      });

      // Cleanup
      await prisma.queue.deleteMany({
        where: {
          guildId: {
            startsWith: 'load-test-query-',
          },
        },
      });
    }, LOAD_TEST_TIMEOUT);
  });

  describe('Redis Operations at Scale', () => {
    it('should handle 1000 concurrent Redis pub/sub messages', async () => {
      const messageCount = 1000;
      const startTime = performance.now();
      const latencies: number[] = [];

      // Publish messages concurrently
      const publishPromises = [];
      for (let i = 0; i < messageCount; i++) {
        const msgStartTime = performance.now();
        const promise = redis.publish(
          'discord-bot:commands',
          JSON.stringify({
            type: 'ping',
            guildId: `load-test-${i}`,
            timestamp: Date.now(),
          })
        ).then(() => {
          latencies.push(performance.now() - msgStartTime);
        });
        publishPromises.push(promise);
      }

      await Promise.all(publishPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert
      const messagesPerSecond = (messageCount / duration) * 1000;
      expect(messagesPerSecond).toBeGreaterThan(500); // At least 500 msg/s

      const p95 = calculatePercentile(latencies, 95);
      expect(p95).toBeLessThan(10); // Redis should be very fast

      console.log('Redis Pub/Sub Performance:', {
        messages: messageCount,
        durationMs: duration.toFixed(2) + 'ms',
        messagesPerSecond: messagesPerSecond.toFixed(2),
        p50: calculatePercentile(latencies, 50).toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: calculatePercentile(latencies, 99).toFixed(2) + 'ms',
      });
    }, LOAD_TEST_TIMEOUT);

    it('should handle cache operations at scale', async () => {
      const keyCount = 1000;
      const startTime = performance.now();

      // Set cache keys
      const setPromises = [];
      for (let i = 0; i < keyCount; i++) {
        setPromises.push(
          redis.set(
            `load-test:cache:${i}`,
            JSON.stringify({ guildId: `guild-${i}`, data: 'test-data' }),
            'EX',
            3600
          )
        );
      }

      await Promise.all(setPromises);
      const setTime = performance.now() - startTime;

      // Get cache keys
      const getStartTime = performance.now();
      const getPromises = [];
      for (let i = 0; i < keyCount; i++) {
        getPromises.push(redis.get(`load-test:cache:${i}`));
      }

      const results = await Promise.all(getPromises);
      const getTime = performance.now() - getStartTime;

      // Assert
      expect(results.filter(r => r !== null)).toHaveLength(keyCount);

      const setsPerSecond = (keyCount / setTime) * 1000;
      const getsPerSecond = (keyCount / getTime) * 1000;

      expect(setsPerSecond).toBeGreaterThan(500);
      expect(getsPerSecond).toBeGreaterThan(1000); // Gets should be faster

      console.log('Redis Cache Performance:', {
        keys: keyCount,
        setTimeMs: setTime.toFixed(2) + 'ms',
        getTimeMs: getTime.toFixed(2) + 'ms',
        setsPerSecond: setsPerSecond.toFixed(2),
        getsPerSecond: getsPerSecond.toFixed(2),
      });

      // Cleanup
      const deletePromises = [];
      for (let i = 0; i < keyCount; i++) {
        deletePromises.push(redis.del(`load-test:cache:${i}`));
      }
      await Promise.all(deletePromises);
    }, LOAD_TEST_TIMEOUT);
  });
});

// Helper functions

async function runConcurrentGuildTest(
  guildCount: number,
  prisma: PrismaClient,
  redis: Redis
): Promise<PerformanceMetrics> {
  const metrics: PerformanceMetrics = {
    totalRequests: guildCount,
    successfulRequests: 0,
    failedRequests: 0,
    latencies: [],
    startTime: performance.now(),
    endTime: 0,
    memoryUsage: process.memoryUsage(),
  };

  // Create concurrent operations for each guild
  const operations = [];
  for (let i = 0; i < guildCount; i++) {
    operations.push(simulateGuildOperation(i, prisma, redis, metrics));
  }

  await Promise.allSettled(operations);

  metrics.endTime = performance.now();
  metrics.memoryUsage = process.memoryUsage();

  return metrics;
}

async function simulateGuildOperation(
  index: number,
  prisma: PrismaClient,
  redis: Redis,
  metrics: PerformanceMetrics
): Promise<void> {
  const startTime = performance.now();
  const guildId = `load-test-${index}`;

  try {
    // Simulate adding a song to queue
    await prisma.queue.create({
      data: {
        guildId,
        title: `Test Song ${index}`,
        author: 'Test Artist',
        url: `https://youtube.com/watch?v=test${index}`,
        duration: 180000,
        position: 0,
        addedBy: 'load-test-user',
      },
    });

    // Simulate Redis cache operation
    await redis.set(`queue:${guildId}`, JSON.stringify({ count: 1 }), 'EX', 300);

    metrics.successfulRequests++;
  } catch (error) {
    metrics.failedRequests++;
    console.error(`Guild ${index} operation failed:`, error);
  } finally {
    const latency = performance.now() - startTime;
    metrics.latencies.push(latency);
  }
}

async function runContinuousOperationsTest(
  guildCount: number,
  operationsPerGuild: number,
  prisma: PrismaClient,
  redis: Redis
): Promise<PerformanceMetrics> {
  const metrics: PerformanceMetrics = {
    totalRequests: guildCount * operationsPerGuild,
    successfulRequests: 0,
    failedRequests: 0,
    latencies: [],
    startTime: performance.now(),
    endTime: 0,
    memoryUsage: process.memoryUsage(),
  };

  // Run operations for each guild
  const guildOperations = [];
  for (let i = 0; i < guildCount; i++) {
    guildOperations.push(
      runGuildOperations(i, operationsPerGuild, prisma, redis, metrics)
    );
  }

  await Promise.allSettled(guildOperations);

  metrics.endTime = performance.now();
  metrics.memoryUsage = process.memoryUsage();

  return metrics;
}

async function runGuildOperations(
  guildIndex: number,
  operationCount: number,
  prisma: PrismaClient,
  redis: Redis,
  metrics: PerformanceMetrics
): Promise<void> {
  const guildId = `load-test-continuous-${guildIndex}`;

  for (let i = 0; i < operationCount; i++) {
    const startTime = performance.now();

    try {
      // Mix of operations: add, query, update
      const operation = i % 3;

      if (operation === 0) {
        // Add song
        await prisma.queue.create({
          data: {
            guildId,
            title: `Song ${i}`,
            author: 'Artist',
            url: `https://youtube.com/watch?v=test${guildIndex}-${i}`,
            duration: 180000,
            position: i,
            addedBy: 'load-test-user',
          },
        });
      } else if (operation === 1) {
        // Query queue
        await prisma.queue.findMany({
          where: { guildId },
          take: 10,
        });
      } else {
        // Cache operation
        await redis.set(`temp:${guildId}:${i}`, 'test', 'EX', 60);
      }

      metrics.successfulRequests++;
    } catch (error) {
      metrics.failedRequests++;
    } finally {
      metrics.latencies.push(performance.now() - startTime);
    }
  }
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function calculateThroughput(metrics: PerformanceMetrics): number {
  const durationSeconds = (metrics.endTime - metrics.startTime) / 1000;
  return metrics.successfulRequests / durationSeconds;
}

function calculateErrorRate(metrics: PerformanceMetrics): number {
  return metrics.failedRequests / metrics.totalRequests;
}

import { prisma, getTransactionManager } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import type { LavalinkManager, Track, UnresolvedTrack, Player } from 'lavalink-client';
import { queueCache } from '../cache.js';
import {
  trackQueueOperation,
  trackQueueOptimization
} from '@discord-bot/database';

export async function saveQueue(
  guildId: string,
  player: Player,
  voiceChannelId?: string,
  textChannelId?: string
): Promise<void> {
  const transactionManager = getTransactionManager(prisma);

  try {
    await transactionManager.withTransaction(async (tx) => {
      // Atomic queue save operation
      let queue = await tx.queue.findFirst({ where: { guildId }, select: { id: true } });

      if (!queue) {
        queue = await tx.queue.create({
          data: {
            guildId,
            voiceChannelId: voiceChannelId ?? null,
            textChannelId: textChannelId ?? null
          },
          select: { id: true }
        });
      } else {
        await tx.queue.update({
          where: { id: queue.id },
          data: {
            voiceChannelId: voiceChannelId ?? null,
            textChannelId: textChannelId ?? null
          }
        });
      }

      // Get current queue items to compare for incremental updates
      const existingItems = await tx.queueItem.findMany({
        where: { queueId: queue.id },
        select: { id: true, url: true, title: true }
      });

      // Prepare new queue items
      const items: Array<{ title: string; url: string; requestedBy: string; duration: number }> = [];

      const current = player.queue.current as { info?: { title?: string; uri?: string; duration?: number }; requester?: { id?: string } } | undefined;
      if (current?.info?.uri) {
        items.push({
          title: current.info.title ?? 'Unknown',
          url: current.info.uri,
          requestedBy: current.requester?.id ?? 'unknown',
          duration: Math.floor((current.info.duration ?? 0) / 1000),
        });
      }

      for (const t of player.queue.tracks as Array<{ info?: { title?: string; uri?: string; duration?: number }; requester?: { id?: string } }>) {
        if (!t.info?.uri) continue;
        items.push({
          title: t.info.title ?? 'Unknown',
          url: t.info.uri,
          requestedBy: t.requester?.id ?? 'unknown',
          duration: Math.floor((t.info.duration ?? 0) / 1000),
        });
      }

      // Implement smart incremental updates instead of full rebuild
      const existingUrls = new Set(existingItems.map(item => item.url));
      const newUrls = new Set(items.map(item => item.url));

      // Find items to remove (exist in DB but not in new queue)
      const itemsToRemove = existingItems.filter(item => !newUrls.has(item.url));

      // Find items to add (exist in new queue but not in DB)
      const itemsToAdd = items.filter(item => !existingUrls.has(item.url));

      // Only perform operations if there are actual changes
      if (itemsToRemove.length > 0) {
        await tx.queueItem.deleteMany({
          where: {
            id: { in: itemsToRemove.map(item => item.id) }
          }
        });
        logger.debug({ guildId, removedCount: itemsToRemove.length }, 'Removed outdated queue items');
        trackQueueOperation('incremental_remove');
      }

      if (itemsToAdd.length > 0) {
        await tx.queueItem.createMany({
          data: itemsToAdd.map((it) => ({ ...it, queueId: queue!.id }))
        });
        logger.debug({ guildId, addedCount: itemsToAdd.length }, 'Added new queue items');
        trackQueueOperation('incremental_add');
        trackQueueOptimization('incremental_update', itemsToAdd.length);
      }

      // If no changes needed, skip rebuild entirely
      if (itemsToRemove.length === 0 && itemsToAdd.length === 0) {
        logger.debug({ guildId, itemCount: items.length }, 'Queue unchanged, skipping database update');
        trackQueueOptimization('skipped_rebuild', 1);
        return;
      }

      logger.debug({
        guildId,
        queueId: queue.id,
        itemCount: items.length,
        voiceChannelId,
        textChannelId
      }, 'Queue saved atomically');
    }, {
      timeout: 10000,
      retryAttempts: 2,
      isolationLevel: 'ReadCommitted'
    });

    invalidateQueueCache(guildId);
  } catch (e) {
    logger.error({
      error: e instanceof Error ? e.message : String(e),
      guildId,
      voiceChannelId,
      textChannelId
    }, 'Failed to save queue atomically');
  }
}

/**
 * Optimized queue operations that avoid full rebuilds
 */
export async function addSingleTrackToQueue(
  guildId: string,
  track: { title: string; url: string; requestedBy: string; duration: number }
): Promise<void> {
  const transactionManager = getTransactionManager(prisma);

  await transactionManager.withTransaction(async (tx) => {
    // Find or create queue
    let queue = await tx.queue.findFirst({
      where: { guildId },
      select: { id: true }
    });

    if (!queue) {
      queue = await tx.queue.create({
        data: { guildId },
        select: { id: true }
      });
    }

    // Add single track - no rebuild needed
    await tx.queueItem.create({
      data: {
        ...track,
        queueId: queue.id
      }
    });

    logger.debug({ guildId, trackTitle: track.title }, 'Added single track to queue');
  });

  trackQueueOperation('incremental_add');
  invalidateQueueCache(guildId);
}

export async function removeSingleTrackFromQueue(
  guildId: string,
  trackUrl: string
): Promise<boolean> {
  const transactionManager = getTransactionManager(prisma);

  const result = await transactionManager.withTransaction(async (tx) => {
    const queue = await tx.queue.findFirst({
      where: { guildId },
      select: { id: true }
    });

    if (!queue) {
      return false;
    }

    const deleteResult = await tx.queueItem.deleteMany({
      where: {
        queueId: queue.id,
        url: trackUrl
      }
    });

    const removed = deleteResult.count > 0;
    if (removed) {
      logger.debug({ guildId, trackUrl }, 'Removed single track from queue');
    }

    return removed;
  });

  if (result) {
    trackQueueOperation('incremental_remove');
    invalidateQueueCache(guildId);
  }

  return result;
}

export async function clearQueue(guildId: string): Promise<void> {
  const transactionManager = getTransactionManager(prisma);

  await transactionManager.withTransaction(async (tx) => {
    const queue = await tx.queue.findFirst({
      where: { guildId },
      select: { id: true }
    });

    if (queue) {
      await tx.queueItem.deleteMany({
        where: { queueId: queue.id }
      });
      logger.debug({ guildId }, 'Cleared queue completely');
    }
  });

  trackQueueOperation('clear');
  invalidateQueueCache(guildId);
}

export async function resumeQueues(manager: LavalinkManager, maxResume: number = 25): Promise<void> {
  try {
    const queues = await prisma.queue.findMany({
      where: {
        voiceChannelId: { not: null },
        items: { some: {} }
      },
      select: {
        guildId: true,
        voiceChannelId: true,
        textChannelId: true,
        items: {
          select: { title: true, url: true },
          orderBy: { createdAt: 'asc' },
          take: maxResume
        }
      }
    });

    const resumePromises = queues.map(async (q) => {
      if (q.items.length === 0 || !q.voiceChannelId) return;

      try {
        const player = manager.createPlayer({
          guildId: q.guildId,
          voiceChannelId: q.voiceChannelId,
          selfDeaf: true,
          volume: 100,
          ...(q.textChannelId ? { textChannelId: q.textChannelId } : {})
        });

        await player.connect();

        for (const it of q.items) {
          const res = await player.search(
            { query: it.url || it.title },
            { id: 'system' } as { id: string }
          );

          if (res.tracks.length > 0) {
            if (!player.playing && !player.paused && !player.queue.current) {
              await player.play({ clientTrack: res.tracks[0] as Track | UnresolvedTrack });
            } else {
              await player.queue.add(res.tracks[0] as Track | UnresolvedTrack);
            }
          }
        }

        logger.debug({ guildId: q.guildId, tracksResumed: q.items.length }, 'Queue resumed successfully');
      } catch (guildError) {
        logger.error({ guildId: q.guildId, error: guildError }, 'Failed to resume queue for guild');
      }
    });

    await Promise.allSettled(resumePromises);
    logger.info({ queuesProcessed: queues.length }, 'Queue resume operation completed');
  } catch (e) {
    logger.error({ error: e }, 'Failed to resume queues');
  }
}

export interface QueueWithItems {
  id: string;
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  items: Array<{
    id: string;
    title: string;
    url: string;
    requestedBy: string;
    duration: number;
  }>;
}

export async function getQueueCached(guildId: string): Promise<QueueWithItems | null> {
  const cacheKey = `queue:${guildId}`;
  let queueData = queueCache.get(cacheKey);
  if (queueData === undefined) {
    try {
      queueData = await prisma.queue.findFirst({
        where: { guildId },
        select: {
          id: true,
          guildId: true,
          voiceChannelId: true,
          textChannelId: true,
          items: {
            select: { id: true, title: true, url: true, requestedBy: true, duration: true },
            orderBy: { createdAt: 'asc' },
            take: 50
          }
        }
      }) as QueueWithItems | null;
      queueCache.set(cacheKey, queueData || null, 30000);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to fetch queue from database');
      return null;
    }
  }
  return queueData as QueueWithItems | null;
}

export function invalidateQueueCache(guildId: string): void {
  queueCache.delete(`queue:${guildId}`);
}


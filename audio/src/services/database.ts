import { prisma } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import type { LavalinkManager, Track, UnresolvedTrack, Player } from 'lavalink-client';
import { queueCache } from '../cache.js';

export async function saveQueue(
  guildId: string,
  player: Player,
  voiceChannelId?: string,
  textChannelId?: string
): Promise<void> {
  try {
    let queue = await prisma.queue.findFirst({ where: { guildId }, select: { id: true } });
    if (!queue) {
      queue = await prisma.queue.create({ data: { guildId, voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null }, select: { id: true } });
    } else {
      await prisma.queue.update({ where: { id: queue.id }, data: { voiceChannelId: voiceChannelId ?? null, textChannelId: textChannelId ?? null } });
    }
    await prisma.queueItem.deleteMany({ where: { queueId: queue.id } });
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
    if (items.length > 0) {
      await prisma.queueItem.createMany({ data: items.map((it) => ({ ...it, queueId: queue!.id })) });
    }
    invalidateQueueCache(guildId);
  } catch (e) {
    logger.error({ e }, 'failed to save queue');
  }
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
    for (const q of queues) {
      if (q.items.length === 0) continue;
      if (!q.voiceChannelId) continue;
      const player = manager.createPlayer({ guildId: q.guildId, voiceChannelId: q.voiceChannelId, selfDeaf: true, volume: 100, ...(q.textChannelId ? { textChannelId: q.textChannelId } : {}) });
      await player.connect();
      for (const it of q.items) {
        const res = await player.search({ query: it.url || it.title }, { id: 'system' } as { id: string });
        if (res.tracks.length > 0) {
          if (!player.playing && !player.paused && !player.queue.current) {
            await player.play({ clientTrack: res.tracks[0] as Track | UnresolvedTrack });
          } else {
            await player.queue.add(res.tracks[0] as Track | UnresolvedTrack);
          }
        }
      }
    }
  } catch (e) {
    logger.error({ e }, 'failed to resume queues');
  }
}

interface QueueWithItems {
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
      });
      queueCache.set(cacheKey, queueData || null, 30000);
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to fetch queue from database');
      return null;
    }
  }
  return queueData;
}

export function invalidateQueueCache(guildId: string): void {
  queueCache.delete(`queue:${guildId}`);
}


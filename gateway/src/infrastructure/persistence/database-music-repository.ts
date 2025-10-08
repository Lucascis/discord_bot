/**
 * Database Music Repository
 * Handles music-related data persistence using Prisma
 */

import { PrismaClient } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

export interface MusicRepository {
  saveQueue(guildId: string, queue: any[]): Promise<void>;
  getQueue(guildId: string): Promise<any[]>;
  clearQueue(guildId: string): Promise<void>;
  addToQueue(guildId: string, item: any): Promise<void>;
  removeFromQueue(guildId: string, index: number): Promise<void>;
  getCurrentTrack(guildId: string): Promise<any | null>;
  setCurrentTrack(guildId: string, track: any): Promise<void>;
}

export class DatabaseMusicRepository implements MusicRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveQueue(guildId: string, queue: any[]): Promise<void> {
    try {
      // First find or create the queue for this guild
      let queueRecord = await this.prisma.queue.findFirst({
        where: { guildId }
      });

      if (!queueRecord) {
        queueRecord = await this.prisma.queue.create({
          data: { guildId }
        });
      }

      // Clear existing queue items
      await this.prisma.queueItem.deleteMany({
        where: { queueId: queueRecord.id }
      });

      // Insert new queue items
      if (queue.length > 0) {
        await this.prisma.queueItem.createMany({
          data: queue.map((item) => ({
            queueId: queueRecord.id,
            title: item.title,
            url: item.url,
            duration: item.duration,
            requestedBy: item.requestedBy
          }))
        });
      }

      logger.debug({ guildId, queueLength: queue.length }, 'Queue saved successfully');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to save queue');
      throw error;
    }
  }

  async getQueue(guildId: string): Promise<any[]> {
    try {
      const queueRecord = await this.prisma.queue.findFirst({
        where: { guildId },
        include: { items: true }
      });

      if (!queueRecord) return [];

      return queueRecord.items.map(item => ({
        title: item.title,
        url: item.url,
        duration: item.duration,
        requestedBy: item.requestedBy,
        addedAt: item.createdAt
      }));
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get queue');
      return [];
    }
  }

  async clearQueue(guildId: string): Promise<void> {
    try {
      const queueRecord = await this.prisma.queue.findFirst({
        where: { guildId }
      });

      if (queueRecord) {
        await this.prisma.queueItem.deleteMany({
          where: { queueId: queueRecord.id }
        });
      }

      logger.debug({ guildId }, 'Queue cleared successfully');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to clear queue');
      throw error;
    }
  }

  async addToQueue(guildId: string, item: any): Promise<void> {
    try {
      // Find or create queue
      let queueRecord = await this.prisma.queue.findFirst({
        where: { guildId }
      });

      if (!queueRecord) {
        queueRecord = await this.prisma.queue.create({
          data: { guildId }
        });
      }

      await this.prisma.queueItem.create({
        data: {
          queueId: queueRecord.id,
          title: item.title,
          url: item.url,
          duration: item.duration,
          requestedBy: item.requestedBy
        }
      });

      logger.debug({ guildId, title: item.title }, 'Item added to queue');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to add item to queue');
      throw error;
    }
  }

  async removeFromQueue(guildId: string, index: number): Promise<void> {
    try {
      const queueRecord = await this.prisma.queue.findFirst({
        where: { guildId },
        include: { items: true }
      });

      if (!queueRecord || index >= queueRecord.items.length) {
        throw new Error('Invalid queue index');
      }

      const itemToRemove = queueRecord.items[index];
      await this.prisma.queueItem.delete({
        where: { id: itemToRemove.id }
      });

      logger.debug({ guildId, index }, 'Item removed from queue');
    } catch (error) {
      logger.error({ error, guildId, index }, 'Failed to remove item from queue');
      throw error;
    }
  }

  async getCurrentTrack(guildId: string): Promise<any | null> {
    try {
      // For now, return the first item in the queue as current track
      const queue = await this.getQueue(guildId);
      return queue.length > 0 ? queue[0] : null;
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get current track');
      return null;
    }
  }

  async setCurrentTrack(guildId: string, track: any): Promise<void> {
    try {
      // For now, this is a no-op since we don't have a separate current track field
      // The current track is always the first item in the queue
      logger.debug({ guildId, track: track?.title }, 'Current track updated');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to set current track');
      throw error;
    }
  }

  async createQueue(guildId: string, voiceChannelId: string, textChannelId: string): Promise<void> {
    try {
      await this.prisma.queue.create({
        data: {
          guildId,
          voiceChannelId,
          textChannelId
        }
      });

      logger.debug({ guildId, voiceChannelId, textChannelId }, 'Queue created');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to create queue');
      throw error;
    }
  }
}
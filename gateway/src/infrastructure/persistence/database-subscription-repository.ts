
/**
 * Database Subscription Repository
 * Handles subscription-related data persistence using Prisma
 */

import { PrismaClient } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

export interface SubscriptionRepository {
  getSubscription(guildId: string): Promise<any | null>;
  createSubscription(guildId: string, planType: string): Promise<any>;
  updateSubscription(guildId: string, data: any): Promise<any>;
  deleteSubscription(guildId: string): Promise<void>;
  getCustomerByGuild(guildId: string): Promise<any | null>;
  createCustomer(email: string, name: string, guildId: string): Promise<any>;
}

export class DatabaseSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSubscription(guildId: string): Promise<any | null> {
    try {
      // Use ServerConfiguration instead of subscription table
      const config = await this.prisma.serverConfiguration.findUnique({
        where: { guildId }
      });

      if (!config) return null;

      return {
        id: config.id,
        guildId: config.guildId,
        planType: config.subscriptionTier,
        status: config.subscriptionExpiresAt && config.subscriptionExpiresAt > new Date() ? 'active' : 'expired',
        currentPeriodStart: config.createdAt,
        currentPeriodEnd: config.subscriptionExpiresAt,
        isActive: config.subscriptionExpiresAt ? config.subscriptionExpiresAt > new Date() : config.subscriptionTier !== 'free',
        isOnTrial: false,
        daysUntilExpiration: config.subscriptionExpiresAt ?
          Math.ceil((config.subscriptionExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0,
        customer: null
      };
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get subscription from database');
      throw error;
    }
  }

  async createSubscription(guildId: string, planType: string): Promise<any> {
    try {
      const config = await this.prisma.serverConfiguration.create({
        data: {
          guildId,
          subscriptionTier: planType,
          subscriptionExpiresAt: planType === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      });

      logger.info({ guildId, planType }, 'Created new subscription');

      return {
        id: config.id,
        guildId: config.guildId,
        planType: config.subscriptionTier,
        status: 'active',
        currentPeriodStart: config.createdAt,
        currentPeriodEnd: config.subscriptionExpiresAt,
        isActive: config.subscriptionExpiresAt ? config.subscriptionExpiresAt > new Date() : config.subscriptionTier !== 'free',
        isOnTrial: false,
        daysUntilExpiration: config.subscriptionExpiresAt ?
          Math.ceil((config.subscriptionExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0,
        customer: null
      };
    } catch (error) {
      logger.error({ error, guildId, planType }, 'Failed to create subscription');
      throw error;
    }
  }

  async updateSubscription(guildId: string, data: any): Promise<any> {
    try {
      const config = await this.prisma.serverConfiguration.update({
        where: { guildId },
        data: {
          subscriptionTier: data.planType || undefined,
          subscriptionExpiresAt: data.currentPeriodEnd || undefined
        }
      });

      logger.info({ guildId, updateData: data }, 'Updated subscription');

      return {
        id: config.id,
        guildId: config.guildId,
        planType: config.subscriptionTier,
        status: config.subscriptionExpiresAt && config.subscriptionExpiresAt > new Date() ? 'active' : 'expired',
        currentPeriodStart: config.createdAt,
        currentPeriodEnd: config.subscriptionExpiresAt,
        isActive: config.subscriptionExpiresAt ? config.subscriptionExpiresAt > new Date() : config.subscriptionTier !== 'free',
        isOnTrial: false,
        daysUntilExpiration: config.subscriptionExpiresAt ?
          Math.ceil((config.subscriptionExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0,
        customer: null
      };
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to update subscription');
      throw error;
    }
  }

  async deleteSubscription(guildId: string): Promise<void> {
    try {
      await this.prisma.serverConfiguration.delete({
        where: { guildId }
      });

      logger.info({ guildId }, 'Deleted subscription');
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to delete subscription');
      throw error;
    }
  }

  async getCustomerByGuild(guildId: string): Promise<any | null> {
    try {
      // Customer model doesn't exist in current schema
      // Return null for now
      return null;
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to get customer by guild');
      throw error;
    }
  }

  async createCustomer(email: string, name: string, guildId: string): Promise<any> {
    try {
      // Customer model doesn't exist in current schema
      // Return placeholder data
      const customer = {
        id: `customer_${guildId}`,
        email,
        name,
        stripeCustomerId: `guild_${guildId}`
      };

      logger.info({ guildId, email, name }, 'Created placeholder customer');

      return customer;
    } catch (error) {
      logger.error({ error, guildId, email }, 'Failed to create customer');
      throw error;
    }
  }
}
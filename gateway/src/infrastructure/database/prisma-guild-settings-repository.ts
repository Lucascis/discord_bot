import { PrismaClient } from '@prisma/client';
import { GuildSettings } from '../../domain/entities/guild-settings.js';
import { GuildSettingsRepository } from '../../domain/repositories/guild-settings-repository.js';
import { GuildId } from '../../domain/value-objects/guild-id.js';

/**
 * Prisma implementation of GuildSettingsRepository
 */
export class PrismaGuildSettingsRepository implements GuildSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByGuildId(guildId: GuildId): Promise<GuildSettings | null> {
    try {
      const guildConfig = await this.prisma.guildConfig.findUnique({
        where: { guildId: guildId.value }
      });

      if (!guildConfig) {
        return null;
      }

      // Get feature flags for this guild
      const flags = await this.prisma.featureFlag.findMany({
        where: { guildId: guildId.value }
      });

      const automixFlag = flags.find(f => f.name === 'autoplay' || f.name === 'automix');

      return GuildSettings.fromData({
        guildId: guildConfig.guildId,
        automixEnabled: automixFlag?.enabled ?? false,
        // Note: Add other fields as they're added to database schema
        defaultVolume: 100, // Default values for now
        maxQueueSize: 100,
        allowExplicit: true
      });

    } catch (error) {
      throw new Error(`Failed to find guild settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async save(settings: GuildSettings): Promise<void> {
    try {
      const data = settings.toData();

      await this.prisma.$transaction(async (tx) => {
        // Upsert guild config
        await tx.guildConfig.upsert({
          where: { guildId: data.guildId },
          create: {
            guildId: data.guildId,
            language: 'en' // Default language
          },
          update: {
            // Update any fields that exist in schema
          }
        });

        // Upsert automix feature flag
        await tx.featureFlag.upsert({
          where: {
            guildId_name: {
              guildId: data.guildId,
              name: 'autoplay'
            }
          },
          create: {
            guildId: data.guildId,
            name: 'autoplay',
            enabled: data.automixEnabled
          },
          update: {
            enabled: data.automixEnabled
          }
        });

        // TODO: Add other settings fields when schema is extended
      });

    } catch (error) {
      throw new Error(`Failed to save guild settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async delete(guildId: GuildId): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Delete feature flags
        await tx.featureFlag.deleteMany({
          where: { guildId: guildId.value }
        });

        // Delete guild config
        await tx.guildConfig.delete({
          where: { guildId: guildId.value }
        });
      });

    } catch (error) {
      // Don't throw if guild doesn't exist
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        return;
      }
      throw new Error(`Failed to delete guild settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async exists(guildId: GuildId): Promise<boolean> {
    try {
      const count = await this.prisma.guildConfig.count({
        where: { guildId: guildId.value }
      });
      return count > 0;

    } catch (error) {
      throw new Error(`Failed to check guild settings existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findAllWithAutomixEnabled(): Promise<GuildSettings[]> {
    try {
      const flags = await this.prisma.featureFlag.findMany({
        where: {
          name: { in: ['autoplay', 'automix'] },
          enabled: true
        },
        include: {
          // Note: We'd need to add a relation to GuildConfig if available
        }
      });

      const settings: GuildSettings[] = [];

      for (const flag of flags) {
        try {
          const guildSettings = GuildSettings.fromData({
            guildId: flag.guildId,
            automixEnabled: true,
            defaultVolume: 100,
            maxQueueSize: 100,
            allowExplicit: true
          });
          settings.push(guildSettings);
        } catch (error) {
          // Skip invalid guild IDs
          continue;
        }
      }

      return settings;

    } catch (error) {
      throw new Error(`Failed to find guilds with automix enabled: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async bulkUpdate(settings: GuildSettings[]): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const setting of settings) {
          const data = setting.toData();

          // Update guild config
          await tx.guildConfig.upsert({
            where: { guildId: data.guildId },
            create: {
              guildId: data.guildId,
              language: 'en'
            },
            update: {}
          });

          // Update feature flags
          await tx.featureFlag.upsert({
            where: {
              guildId_name: {
                guildId: data.guildId,
                name: 'autoplay'
              }
            },
            create: {
              guildId: data.guildId,
              name: 'autoplay',
              enabled: data.automixEnabled
            },
            update: {
              enabled: data.automixEnabled
            }
          });
        }
      });

    } catch (error) {
      throw new Error(`Failed to bulk update guild settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
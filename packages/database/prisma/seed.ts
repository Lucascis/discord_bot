/**
 * Prisma Database Seed
 *
 * Seeds initial data for development and production environments
 * Run with: pnpm --filter @discord-bot/database prisma db seed
 */

import { prisma } from '../src/index.js';
import { SubscriptionTier, FeatureCategory, FeatureType } from '@prisma/client';

/**
 * Seed Features
 * Populates the Feature table with all available features
 */
async function seedFeatures() {
  console.log('📦 Seeding features...');

  const features = [
    // PLAYBACK FEATURES
    {
      key: 'concurrent_playbacks',
      name: 'Concurrent Playbacks',
      description: 'Number of simultaneous music playbacks allowed',
      category: FeatureCategory.PLAYBACK,
      type: FeatureType.NUMERIC,
      availableInFree: true,
      availableInBasic: true,
      availableInPremium: true,
      availableInEnterprise: true,
      freeValue: '1',
      basicValue: '3',
      premiumValue: '10',
      enterpriseValue: '-1',
      isActive: true,
      sortOrder: 1,
    },
    {
      key: 'autoplay_enabled',
      name: 'Autoplay',
      description: 'Automatic track queueing when queue is empty',
      category: FeatureCategory.PLAYBACK,
      type: FeatureType.BOOLEAN,
      availableInFree: false,
      availableInBasic: true,
      availableInPremium: true,
      availableInEnterprise: true,
      freeValue: 'false',
      basicValue: 'true',
      premiumValue: 'true',
      enterpriseValue: 'true',
      isActive: true,
      sortOrder: 2,
    },
    {
      key: 'advanced_commands',
      name: 'Advanced Commands',
      description: 'Access to advanced music commands (seek, loop, filter)',
      category: FeatureCategory.COMMANDS,
      type: FeatureType.BOOLEAN,
      availableInFree: false,
      availableInBasic: true,
      availableInPremium: true,
      availableInEnterprise: true,
      freeValue: 'false',
      basicValue: 'true',
      premiumValue: 'true',
      enterpriseValue: 'true',
      isActive: true,
      sortOrder: 21,
    },
  ];

  for (const feature of features) {
    await prisma.feature.upsert({
      where: { key: feature.key },
      update: feature,
      create: feature,
    });
  }

  console.log(`✅ Seeded ${features.length} features`);
}

/**
 * Seed default FREE subscription for development guilds
 */
async function seedDevelopmentSubscriptions() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  console.log('📦 Seeding development subscriptions...');

  const devGuildIds = process.env.DEV_GUILD_IDS?.split(',') || [];

  for (const guildId of devGuildIds) {
    if (!guildId.trim()) continue;

    await prisma.subscription.upsert({
      where: { guildId: guildId.trim() },
      update: {},
      create: {
        guildId: guildId.trim(),
        tier: SubscriptionTier.PREMIUM, // Give devs premium for testing
        status: 'ACTIVE',
      },
    });

    console.log(`✅ Created PREMIUM subscription for dev guild: ${guildId}`);
  }
}

/**
 * Main seed function
 */
async function main() {
  console.log('🌱 Starting database seed...\n');

  try {
    await seedFeatures();
    await seedDevelopmentSubscriptions();

    console.log('\n✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

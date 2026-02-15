/**
 * Prisma Database Seed
 *
 * Seeds initial data for development and production environments
 * Run with: pnpm --filter @discord-bot/database prisma db seed
 */

let prisma: Awaited<typeof import('../src/index.js')>['prisma'];
let SubscriptionTier: typeof import('@discord-bot/database')['SubscriptionTier'];
let SubscriptionStatus: typeof import('@discord-bot/database')['SubscriptionStatus'];
let BillingInterval: typeof import('@discord-bot/database')['BillingInterval'];
let FeatureCategory: typeof import('@discord-bot/database')['FeatureCategory'];
let FeatureType: typeof import('@discord-bot/database')['FeatureType'];
let PLAN_TEMPLATES: typeof import('@discord-bot/subscription')['PLAN_TEMPLATES'];

async function importFromCandidates<T>(candidates: string[], label: string): Promise<T> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await import(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Failed to import ${label}: ${describeSeedError(lastError)}`);
}

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT_SEED_ERROR', describeSeedError(error));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED_SEED_REJECTION', describeSeedError(reason));
  process.exit(1);
});

function describeSeedError(error: unknown) {
  if (!error) return { message: 'Unknown error', error };
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...('code' in error ? { code: (error as { code?: unknown }).code } : {})
    };
  }
  const proto = Object.getPrototypeOf(error);
  const props = typeof error === 'object' && error !== null
    ? Object.getOwnPropertyNames(error)
    : [];
  return {
    type: typeof error,
    proto: proto ? proto.constructor?.name ?? 'unknown' : 'null',
    props,
    value: error
  };
}

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
 * Seed Subscription Plans
 * Ensures subscription_plans has at least the core tiers
 * (FREE, BASIC, PREMIUM, ENTERPRISE) backed by the PLAN_TEMPLATES
 * used at runtime by the subscription package.
 */
async function seedSubscriptionPlans() {
  console.log('📦 Seeding subscription plans...');

  const tiers = ['FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE'] as const;

  for (const tierKey of tiers) {
    const template = PLAN_TEMPLATES[tierKey];
    if (!template) continue;

    const name = template.name;

    const plan = await prisma.subscriptionPlan.upsert({
      where: { name },
      update: {
        displayName: template.displayName,
        description: template.description,
        features: template.features,
        limits: template.limits,
        active: true,
      },
      create: {
        name,
        displayName: template.displayName,
        description: template.description,
        features: template.features,
        limits: template.limits,
        active: true,
      },
    });

    const monthlyAmount = template.price.monthly ?? 0;
    const yearlyAmount = template.price.yearly ?? 0;

    await prisma.subscriptionPrice.upsert({
      where: {
        provider_providerPriceId: {
          provider: 'internal',
          providerPriceId: `seed-${name}-monthly`,
        },
      },
      update: {
        planId: plan.id,
        amount: monthlyAmount,
        currency: 'USD',
        interval: BillingInterval.MONTH,
        active: true,
      },
      create: {
        planId: plan.id,
        provider: 'internal',
        providerPriceId: `seed-${name}-monthly`,
        amount: monthlyAmount,
        currency: 'USD',
        interval: BillingInterval.MONTH,
        active: true,
      },
    });

    await prisma.subscriptionPrice.upsert({
      where: {
        provider_providerPriceId: {
          provider: 'internal',
          providerPriceId: `seed-${name}-yearly`,
        },
      },
      update: {
        planId: plan.id,
        amount: yearlyAmount,
        currency: 'USD',
        interval: BillingInterval.YEAR,
        active: true,
      },
      create: {
        planId: plan.id,
        provider: 'internal',
        providerPriceId: `seed-${name}-yearly`,
        amount: yearlyAmount,
        currency: 'USD',
        interval: BillingInterval.YEAR,
        active: true,
      },
    });
  }

  const count = await prisma.subscriptionPlan.count();
  console.log(`✅ Seeded ${count} subscription plans`);
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

    const id = guildId.trim();
    const premiumPlan = await prisma.subscriptionPlan.findUnique({ where: { name: 'premium' } });
    const premiumPrice = premiumPlan
      ? await prisma.subscriptionPrice.findFirst({
        where: {
          planId: premiumPlan.id,
          interval: BillingInterval.MONTH,
          active: true,
        },
      })
      : null;

    if (!premiumPlan || !premiumPrice) {
      console.warn('⚠️ Skipping dev subscription seed: missing premium plan or price.');
      continue;
    }

    const customer = await prisma.customer.upsert({
      where: { discordUserId: id },
      update: {},
      create: {
        discordUserId: id,
        email: `guild-${id}@placeholder.local`,
        status: 'ACTIVE',
      },
    });

    await prisma.subscription.upsert({
      where: { providerSubscriptionId: `seed-${id}` },
      update: {
        status: SubscriptionStatus.ACTIVE,
        planId: premiumPlan.id,
        priceId: premiumPrice.id,
      },
      create: {
        customerId: customer.id,
        planId: premiumPlan.id,
        priceId: premiumPrice.id,
        provider: 'internal',
        providerSubscriptionId: `seed-${id}`,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    console.log(`✅ Created PREMIUM subscription for dev guild: ${guildId}`);
  }
}

async function seedRuntimeConfigDefinitions() {
  console.log('📦 Seeding runtime config definitions...');

  const definitions = [
    {
      key: 'NOWPLAYING_UPDATE_MS',
      scope: 'MIXED',
      valueType: 'NUMBER',
      sensitivity: 'PUBLIC',
      planMinTier: 'FREE',
      mutable: true,
      hotReload: true,
      description: 'Interval in ms for now-playing UI updates',
      validationSchema: { type: 'number', min: 1000, max: 60000 },
    },
    {
      key: 'RATE_LIMIT_STRICT_MAX',
      scope: 'GLOBAL',
      valueType: 'NUMBER',
      sensitivity: 'PUBLIC',
      planMinTier: 'FREE',
      mutable: true,
      hotReload: true,
      description: 'Strict rate limit max requests',
      validationSchema: { type: 'number', min: 1, max: 10000 },
    },
    {
      key: 'RATE_LIMIT_STRICT_WINDOW_MS',
      scope: 'GLOBAL',
      valueType: 'NUMBER',
      sensitivity: 'PUBLIC',
      planMinTier: 'FREE',
      mutable: true,
      hotReload: true,
      description: 'Strict rate limit window in milliseconds',
      validationSchema: { type: 'number', min: 1000, max: 3600000 },
    },
    {
      key: 'ALLOWED_ORIGINS',
      scope: 'GLOBAL',
      valueType: 'STRING',
      sensitivity: 'RESTRICTED',
      planMinTier: 'FREE',
      mutable: true,
      hotReload: true,
      description: 'CORS allowlist origins',
      validationSchema: { type: 'string', maxLength: 2000 },
    },
    {
      key: 'DEFAULT_VOLUME',
      scope: 'MIXED',
      valueType: 'NUMBER',
      sensitivity: 'PUBLIC',
      planMinTier: 'FREE',
      mutable: true,
      hotReload: true,
      description: 'Default playback volume',
      validationSchema: { type: 'number', min: 0, max: 200 },
    },
    {
      key: 'AUTOPLAY_ENABLED',
      scope: 'MIXED',
      valueType: 'BOOLEAN',
      sensitivity: 'PUBLIC',
      planMinTier: 'BASIC',
      mutable: true,
      hotReload: true,
      description: 'Enable autoplay behavior',
      validationSchema: { type: 'boolean' },
    },
  ] as const;

  for (const definition of definitions) {
    await prisma.runtimeConfigDefinition.upsert({
      where: { key: definition.key },
      update: {
        scope: definition.scope,
        valueType: definition.valueType,
        sensitivity: definition.sensitivity,
        planMinTier: definition.planMinTier,
        mutable: definition.mutable,
        hotReload: definition.hotReload,
        description: definition.description,
        validationSchema: definition.validationSchema,
      },
      create: {
        ...definition,
      },
    });
  }

  console.log(`✅ Seeded ${definitions.length} runtime config definitions`);
}

async function seedSuperAdmin() {
  const fromDedicated = process.env.DISCORD_SUPERADMIN_USER_ID?.trim();
  const fromStaff = (process.env.PANEL_STAFF_DISCORD_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean);
  const discordUserId = fromDedicated || fromStaff;
  if (!discordUserId) {
    console.log('ℹ️ Skipping superadmin seed (no DISCORD_SUPERADMIN_USER_ID/PANEL_STAFF_DISCORD_IDS)');
    return;
  }

  if (!/^\d{17,19}$/.test(discordUserId)) {
    console.warn(`⚠️ Skipping superadmin seed due to invalid Discord ID: ${discordUserId}`);
    return;
  }

  await prisma.adminUser.upsert({
    where: { discordUserId },
    update: {
      role: 'SUPERADMIN',
      active: true,
    },
    create: {
      discordUserId,
      role: 'SUPERADMIN',
      active: true,
    },
  });

  console.log(`✅ Seeded SUPERADMIN user ${discordUserId}`);
}

/**
 * Main seed function
 */
async function main() {
  console.log('🌱 Starting database seed...\n');

  try {
    const [database, subscription, prismaModule] = await Promise.all([
      importFromCandidates<typeof import('@discord-bot/database')>(
        ['@discord-bot/database', '../dist/index.js', '../src/index.js'],
        '@discord-bot/database'
      ),
      importFromCandidates<typeof import('@discord-bot/subscription')>(
        ['@discord-bot/subscription', '../../subscription/dist/index.js', '../../subscription/src/index.js'],
        '@discord-bot/subscription'
      ),
      importFromCandidates<typeof import('../src/index.js')>(
        ['../src/index.js', '../dist/index.js'],
        'database prisma'
      )
    ]);

    prisma = prismaModule.prisma;
    ({ SubscriptionTier, SubscriptionStatus, BillingInterval, FeatureCategory, FeatureType } = database);
    ({ PLAN_TEMPLATES } = subscription);

    await seedFeatures();
    await seedSubscriptionPlans();
    await seedDevelopmentSubscriptions();
    await seedRuntimeConfigDefinitions();
    await seedSuperAdmin();

    console.log('\n✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', describeSeedError(error));
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(describeSeedError(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

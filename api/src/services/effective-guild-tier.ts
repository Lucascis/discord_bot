import { env } from '@discord-bot/config';

export type EffectiveGuildTier = 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';

type ResolveGuildTierInput = {
  guildId: string;
  serverConfigTier?: string | null;
  guildSubscriptionTier?: string | null;
};

export function normalizeGuildTier(value?: string | null): EffectiveGuildTier {
  const normalized = (value ?? 'FREE').toUpperCase();
  if (normalized === 'ENTERPRISE') return 'ENTERPRISE';
  if (normalized === 'PREMIUM' || normalized === 'DIAMOND') return 'PREMIUM';
  if (normalized === 'BASIC' || normalized === 'GOLD') return 'BASIC';
  return 'FREE';
}

export function resolveGuildTier({
  guildId,
  serverConfigTier,
  guildSubscriptionTier,
}: ResolveGuildTierInput): {
  dbTier: EffectiveGuildTier;
  effectiveTier: EffectiveGuildTier;
  source: 'database:guild_subscriptions/server_configuration' | 'env_override:PREMIUM_TEST_GUILD_IDS';
  overrideActive: boolean;
} {
  const dbTier = normalizeGuildTier(guildSubscriptionTier ?? serverConfigTier ?? 'FREE');
  const overrideActive = env.PREMIUM_TEST_GUILD_IDS_LIST.includes(guildId);

  if (overrideActive) {
    return {
      dbTier,
      effectiveTier: 'PREMIUM',
      source: 'env_override:PREMIUM_TEST_GUILD_IDS',
      overrideActive: true,
    };
  }

  return {
    dbTier,
    effectiveTier: dbTier,
    source: 'database:guild_subscriptions/server_configuration',
    overrideActive: false,
  };
}

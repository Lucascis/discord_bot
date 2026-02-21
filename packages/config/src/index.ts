import { z } from 'zod';

const booleanLike = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}, z.string().url().optional());

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 50, 'Discord token too short').regex(/^[A-Za-z0-9._-]+$/, 'Invalid Discord token format'),
  DISCORD_APPLICATION_ID: z.string().regex(process.env.NODE_ENV === 'test' ? /^.+$/ : /^\d{17,19}$/, 'Invalid Discord Application ID format'),
  DISCORD_GUILD_ID: z.string().regex(/^\d{17,19}$/, 'Invalid Discord Guild ID format').optional(),
  DATABASE_URL: z.string().url('Invalid DATABASE_URL format').refine(url => url.startsWith('postgresql://') || url.startsWith('postgres://'), 'DATABASE_URL must be a PostgreSQL connection string'),
  REDIS_URL: z.string().url('Invalid REDIS_URL format').default('redis://localhost:6379'),
  LAVALINK_HOST: z.string().min(1, 'LAVALINK_HOST cannot be empty').default('lavalink'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535, 'Invalid port range').default(2333),
  LAVALINK_PASSWORD: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 8, 'LAVALINK_PASSWORD must be at least 8 characters'),
  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional().refine((value) => {
    if (!value || value.trim() === '' || value.startsWith('your-')) return true;
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }, 'Invalid SENTRY_DSN format'),
  SENTRY_ENVIRONMENT: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  // Service HTTP ports for health/metrics
  GATEWAY_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3001),
  AUDIO_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3002),
  WORKER_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3003),
  // Permissions
  DJ_ROLE_NAME: z.string().min(1).max(32, 'Role name too long').default('DJ'),
  // API Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_KEY: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  NEXTAUTH_SECRET: z.string().min(16).optional(),
  PANEL_STREAM_SECRET: z.string().optional(),
  ENV_DEBUG: booleanLike.default(false),
  GATEWAY_MANUAL_GC_ENABLED: booleanLike.default(false),
  GATEWAY_GC_HEAP_THRESHOLD: z.coerce.number().min(0.5).max(0.99).default(0.9),
  GATEWAY_GC_MIN_INTERVAL_MS: z.coerce.number().int().min(60000).default(600000),
  // UI/UX
  NOWPLAYING_UPDATE_MS: z.coerce.number().int().min(1000, 'Update interval too frequent').max(60000, 'Update interval too slow').default(5000),
  NOWPLAYING_CONTROL_MIN_INTERVAL_MS: z.coerce.number().int().min(100).max(5000).default(200),
  ALLOWED_ORIGINS: z.string().default(''),
  METRICS_IP_ALLOWLIST: z.string().default('127.0.0.1,::1,::ffff:127.0.0.1,172.20.,::ffff:172.20.'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  RATE_LIMIT_STRICT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  RATE_LIMIT_STRICT_MAX: z.coerce.number().int().min(1).default(20),
  API_RATE_LIMIT_IN_MEMORY: booleanLike.default(false),
  API_RATE_LIMIT_DEFAULT_TIER: z.enum(['FREE', 'GOLD', 'DIAMOND', 'ENTERPRISE']).default('FREE'),
  BILLING_CURRENCY: z.string().default('usd'),
  BILLING_PORTAL_URL: z.string().optional(),
  UPGRADE_URL: z.string().optional(),
  PANEL_STAFF_DISCORD_IDS: z.string().optional(),
  DISCORD_SUPERADMIN_USER_ID: z.string().optional(),
  // Commands maintenance
  COMMANDS_CLEANUP_ON_START: booleanLike.default(false),
  // Command registration scope: global | guild | both
  COMMANDS_SCOPE: z.enum(['global', 'guild', 'both']).default('global'),
  // LavaSrc optional credentials - integrations auto-enable when credentials are provided
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  DEEZER_ARL: z.string().optional(),
  APPLE_MUSIC_MEDIA_TOKEN: z.string().optional(),
  YOUTUBE_PO_TOKEN: z.string().optional(),
  YOUTUBE_VISITOR_DATA: z.string().optional(),
  YOUTUBE_TOKEN_AUTO_ENABLED: booleanLike.default(false),
  YOUTUBE_TOKEN_AUTO_REFRESH_MS: z.coerce.number().int().min(60000).default(900000), // 15 min - prevents ~30 min playback stop (token expiry)
  YOUTUBE_TOKEN_AUTO_ENDPOINT: optionalUrl,
  YOUTUBE_TOKEN_AUTO_ENDPOINT_BEARER: z.string().optional(),
  // Premium testing helpers
  PREMIUM_TEST_GUILD_IDS: z.string().optional(),
  // Real audio E2E probe
  DISCORD_PROBE_TOKEN: z.string().optional(),
  DISCORD_TEST_GUILD_ID: z.string().optional().refine((value) => !value || /^\d{17,19}$/.test(value), 'Invalid DISCORD_TEST_GUILD_ID format'),
  DISCORD_TEST_VOICE_CHANNEL_ID: z.string().optional().refine((value) => !value || /^\d{17,19}$/.test(value), 'Invalid DISCORD_TEST_VOICE_CHANNEL_ID format'),
  DISCORD_TEST_TEXT_CHANNEL_ID: z.string().optional().refine((value) => !value || /^\d{17,19}$/.test(value), 'Invalid DISCORD_TEST_TEXT_CHANNEL_ID format'),
  E2E_AUDIO_RMS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.015),
  E2E_AUDIO_CONSECUTIVE_WINDOWS: z.coerce.number().int().min(1).max(200).default(8),
  // AI Tools
  TAVILY_API_KEY: z.string().optional(),
}).refine(data => {
  // Ensure ports don't conflict
  const ports = [data.GATEWAY_HTTP_PORT, data.AUDIO_HTTP_PORT, data.WORKER_HTTP_PORT];
  const uniquePorts = new Set(ports);
  return uniquePorts.size === ports.length;
}, 'HTTP ports must be unique across services');

export type Environment = 'development' | 'staging' | 'production' | 'test';

export type Env = z.infer<typeof envSchema> & {
  // Computed properties for auto-enabled integrations
  SPOTIFY_ENABLED: boolean;
  DEEZER_ENABLED: boolean;
  APPLE_ENABLED: boolean;
  PREMIUM_TEST_GUILD_IDS_LIST: string[];
};

// Parse and validate environment with detailed error logging
let env: Env;
try {
  const baseEnv = envSchema.parse(process.env);

  // Auto-enable integrations when credentials are provided
  env = {
    ...baseEnv,
    SPOTIFY_ENABLED: !!(baseEnv.SPOTIFY_CLIENT_ID && baseEnv.SPOTIFY_CLIENT_SECRET),
    DEEZER_ENABLED: !!baseEnv.DEEZER_ARL,
    APPLE_ENABLED: !!baseEnv.APPLE_MUSIC_MEDIA_TOKEN,
    PREMIUM_TEST_GUILD_IDS_LIST: (() => {
      const rawIds = (baseEnv.PREMIUM_TEST_GUILD_IDS ?? '')
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);

      const validIds: string[] = [];
      const invalidIds: string[] = [];

      for (const id of rawIds) {
        if (/^\d{17,19}$/.test(id)) {
          if (!validIds.includes(id)) {
            validIds.push(id);
          }
        } else {
          invalidIds.push(id);
        }
      }

      if (invalidIds.length > 0) {
        console.warn(
          `Ignoring invalid PREMIUM_TEST_GUILD_IDS entries: ${invalidIds.join(', ')}. ` +
          'Guild IDs must be 17-19 digit numbers.',
        );
      }

      return validIds;
    })(),
  };

  // Additional runtime security checks (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    if (env.DISCORD_TOKEN === 'your-bot-token') {
      throw new Error('DISCORD_TOKEN must be set to a real bot token, not the example value');
    }

    if (env.DISCORD_APPLICATION_ID === 'your-application-id') {
      throw new Error('DISCORD_APPLICATION_ID must be set to a real application ID, not the example value');
    }

    if (env.LAVALINK_PASSWORD === 'youshallnotpass') {
      console.warn('Warning: Using default LAVALINK_PASSWORD. Consider setting a unique password for production.');
    }

    // Warn about insecure configurations
    if (env.DATABASE_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
      console.warn('Warning: Using localhost database in production environment');
    }

    if (env.REDIS_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
      console.warn('Warning: Using localhost Redis in production environment');
    }
  }

} catch (error) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Environment validation failed:', error instanceof Error ? error.message : String(error));

    if (error instanceof z.ZodError) {
      console.error('\n=== Environment Configuration Errors ===');
      error.issues.forEach(issue => {
        console.error(`${issue.path.join('.')}: ${issue.message}`);
      });
      console.error('\nPlease check your .env file and fix the above issues.\n');
    }

    process.exit(1);
  } else {
    // In test environment, throw the error to be handled by test framework
    throw error;
  }
}

export { env };

// Export premium features
export * from './premium-features.js';
export * from './enhanced-premium-config.js';

// Export types for easier imports
export type {
  FeatureName,
  PeriodType,
  FeatureCategory,
  AudioQualityLevel,
  Tier,
  Quality
} from './enhanced-premium-config.js';

// Export helper functions
export {
  hasFeatureAccess,
  getAvailableFeatures,
  getQuotaForTier,
  getRestrictionForTier,
  calculatePriceWithPeriod,
  getFeaturesByCategory,
  validateUsageQuota
} from './enhanced-premium-config.js';

// Export feature configurations
export {
  ENHANCED_PREMIUM_FEATURES,
  FEATURE_CATEGORIES,
  FEATURE_TIER_REQUIREMENTS,
  BILLING_PERIODS,
  ENHANCED_PRICING,
  FEATURE_ROLLOUT
} from './enhanced-premium-config.js';

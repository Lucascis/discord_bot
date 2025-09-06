import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 50, 'Discord token too short').regex(/^[A-Za-z0-9._-]+$/, 'Invalid Discord token format'),
  DISCORD_APPLICATION_ID: z.string().regex(process.env.NODE_ENV === 'test' ? /^.+$/ : /^\d{17,19}$/, 'Invalid Discord Application ID format'),
  DISCORD_GUILD_ID: z.string().regex(/^\d{17,19}$/, 'Invalid Discord Guild ID format').optional(),
  DATABASE_URL: z.string().url('Invalid DATABASE_URL format').refine(url => url.startsWith('postgresql://') || url.startsWith('postgres://'), 'DATABASE_URL must be a PostgreSQL connection string'),
  REDIS_URL: z.string().url('Invalid REDIS_URL format').default('redis://localhost:6379'),
  LAVALINK_HOST: z.string().min(1, 'LAVALINK_HOST cannot be empty').default('localhost'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535, 'Invalid port range').default(2333),
  LAVALINK_PASSWORD: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 8, 'LAVALINK_PASSWORD must be at least 8 characters'),
  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  // Service HTTP ports for health/metrics
  GATEWAY_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3001),
  AUDIO_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3002),
  WORKER_HTTP_PORT: z.coerce.number().int().min(1000).max(65535).default(3003),
  // Permissions
  DJ_ROLE_NAME: z.string().min(1).max(32, 'Role name too long').default('DJ'),
  // UI/UX
  NOWPLAYING_UPDATE_MS: z.coerce.number().int().min(1000, 'Update interval too frequent').max(60000, 'Update interval too slow').default(5000),
  // Commands maintenance
  COMMANDS_CLEANUP_ON_START: z.coerce.boolean().default(false),
  // Command registration scope: global | guild | both
  COMMANDS_SCOPE: z.enum(['global', 'guild', 'both']).default('global'),
  // LavaSrc optional credentials - integrations auto-enable when credentials are provided
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  DEEZER_ARL: z.string().optional(),
  APPLE_MUSIC_MEDIA_TOKEN: z.string().optional(),
}).refine(data => {
  // Ensure ports don't conflict
  const ports = [data.GATEWAY_HTTP_PORT, data.AUDIO_HTTP_PORT, data.WORKER_HTTP_PORT];
  const uniquePorts = new Set(ports);
  return uniquePorts.size === ports.length;
}, 'HTTP ports must be unique across services');

export type Env = z.infer<typeof envSchema> & {
  // Computed properties for auto-enabled integrations
  SPOTIFY_ENABLED: boolean;
  DEEZER_ENABLED: boolean;
  APPLE_ENABLED: boolean;
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

import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string(),
  DISCORD_APPLICATION_ID: z.string(),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LAVALINK_HOST: z.string().default('localhost'),
  LAVALINK_PORT: z.coerce.number().default(2333),
  LAVALINK_PASSWORD: z.string(),
  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  // Service HTTP ports for health/metrics
  GATEWAY_HTTP_PORT: z.coerce.number().default(3001),
  AUDIO_HTTP_PORT: z.coerce.number().default(3002),
  WORKER_HTTP_PORT: z.coerce.number().default(3003),
  // Permissions
  DJ_ROLE_NAME: z.string().default('DJ'),
  // UI/UX
  NOWPLAYING_UPDATE_MS: z.coerce.number().default(5000),
  // Commands maintenance
  COMMANDS_CLEANUP_ON_START: z.coerce.boolean().default(false),
  // LavaSrc optional credentials
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  DEEZER_ARL: z.string().optional(),
  APPLE_MUSIC_MEDIA_TOKEN: z.string().optional(),
  // Feature flags to enable LavaSrc sources only when desired
  SPOTIFY_ENABLED: z.coerce.boolean().default(false),
  DEEZER_ENABLED: z.coerce.boolean().default(false),
  APPLE_ENABLED: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

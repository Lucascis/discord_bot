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
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

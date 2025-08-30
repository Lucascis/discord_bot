import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string(),
  DATABASE_URL: z.string(),
  LAVALINK_HOST: z.string().default('localhost'),
  LAVALINK_PORT: z.coerce.number().default(2333),
  LAVALINK_PASSWORD: z.string(),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

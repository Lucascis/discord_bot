import dotenv from 'dotenv';
import path from 'path';

const envDebug = process.env.ENV_DEBUG === 'true';
const candidatePaths = [
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), '.env'),
];

const loadedFrom: string[] = [];
for (const envPath of candidatePaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    loadedFrom.push(envPath);
  }
}

if (envDebug) {
  console.info('[env-loader][worker] Loaded environment files', loadedFrom);
  console.info('[env-loader][worker] Key presence', {
    DISCORD_TOKEN: Boolean(process.env.DISCORD_TOKEN),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    REDIS_URL: Boolean(process.env.REDIS_URL),
    LAVALINK_PASSWORD: Boolean(process.env.LAVALINK_PASSWORD),
  });
}

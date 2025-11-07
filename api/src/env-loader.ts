// Environment variable loader - must be imported first
import dotenv from 'dotenv';
import path from 'path';

// In test environment, load .env.test from project root
if (process.env.NODE_ENV === 'test') {
  const testEnvPath = path.resolve(process.cwd(), '..', '.env.test');
  dotenv.config({ path: testEnvPath });
} else {
  // Load from project root .env file
  const rootPath = path.resolve(process.cwd(), '..', '.env');
  const localPath = path.resolve('.env');

  // Try root path first
  dotenv.config({ path: rootPath });
  // Also try local path as fallback
  dotenv.config({ path: localPath });
}

console.log('✅ Environment variables loaded successfully');
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? 'SET' : 'MISSING');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
console.log('LAVALINK_PASSWORD:', process.env.LAVALINK_PASSWORD ? 'SET' : 'MISSING');
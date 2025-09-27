// Environment variable loader - must be imported first
import dotenv from 'dotenv';
import path from 'path';

// Load from project root .env file (when running from root with pnpm dev:all)
const rootPath = path.resolve(process.cwd(), '.env');
// Also try parent path (when running directly from audio folder)
const parentPath = path.resolve(process.cwd(), '..', '.env');
const localPath = path.resolve('.env');

console.log('🔧 Loading environment variables...');
console.log('Current working directory:', process.cwd());
console.log('Trying paths:');
console.log('  - rootPath:', rootPath);
console.log('  - parentPath:', parentPath);
console.log('  - localPath:', localPath);

// Try root path first (most common case)
dotenv.config({ path: rootPath });
// Also try parent path as fallback
dotenv.config({ path: parentPath });
// Also try local path as fallback
dotenv.config({ path: localPath });

console.log('✅ Environment variables loaded successfully');
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? 'SET' : 'MISSING');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
console.log('LAVALINK_PASSWORD:', process.env.LAVALINK_PASSWORD ? 'SET' : 'MISSING');
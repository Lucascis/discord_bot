import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Try loading .env from current directory first, then parent directory
const envPath1 = resolve(process.cwd(), '.env');
const envPath2 = resolve(process.cwd(), '..', '.env');
const fs = await import('fs');
if (fs.existsSync(envPath1)) {
  dotenv.config({ path: envPath1 });
} else {
  dotenv.config({ path: envPath2 });
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

console.log('🗑️  Deleting all commands...\n');

try {
  // Delete global commands
  console.log('🌍 Deleting global commands...');
  await rest.put(
    Routes.applicationCommands(DISCORD_APPLICATION_ID),
    { body: [] }
  );
  console.log('✅ Global commands deleted');

  // Delete guild commands if DISCORD_GUILD_ID is set
  if (DISCORD_GUILD_ID) {
    console.log(`🏠 Deleting guild commands for guild: ${DISCORD_GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID),
      { body: [] }
    );
    console.log('✅ Guild commands deleted');
  }

  console.log('\n🎉 All commands deleted successfully!');
} catch (error) {
  console.error('❌ Error deleting commands:', error);
  process.exit(1);
}

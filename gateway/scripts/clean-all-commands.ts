import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') });

const GUILD_ID = "375086837103984650";

async function cleanAllCommands() {
  console.log('🧹 Starting complete command cleanup...');

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

  try {
    // Clean guild commands
    console.log(`📍 Cleaning guild commands for ${GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID!, GUILD_ID),
      { body: [] }
    );
    console.log('✅ Guild commands cleaned');

    // Clean global commands
    console.log('🌍 Cleaning global commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID!),
      { body: [] }
    );
    console.log('✅ Global commands cleaned');

    console.log('✨ All commands have been removed. Discord cache may take a few minutes to update.');
    console.log('💡 Tip: Restart Discord (Ctrl+R) to see changes immediately.');
  } catch (error) {
    console.error('❌ Error cleaning commands:', error);
    process.exit(1);
  }
}

cleanAllCommands();
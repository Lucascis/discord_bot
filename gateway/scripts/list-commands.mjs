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

console.log('📋 Fetching registered commands from Discord API...\n');

try {
  let commands;
  if (DISCORD_GUILD_ID) {
    console.log(`🏠 Fetching guild commands for guild: ${DISCORD_GUILD_ID}`);
    commands = await rest.get(
      Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID)
    );
  } else {
    console.log('🌍 Fetching global commands');
    commands = await rest.get(
      Routes.applicationCommands(DISCORD_APPLICATION_ID)
    );
  }

  console.log(`\n✅ Found ${commands.length} registered commands:\n`);

  commands.forEach((cmd, index) => {
    console.log(`${index + 1}. /${cmd.name} - ${cmd.description}`);
    if (cmd.options && cmd.options.length > 0) {
      cmd.options.forEach(opt => {
        if (opt.type === 1) { // Subcommand
          console.log(`   └─ ${opt.name}: ${opt.description}`);
        }
      });
    }
  });

  console.log(`\n📊 Total: ${commands.length} commands`);
} catch (error) {
  console.error('❌ Error fetching commands:', error.message);
}

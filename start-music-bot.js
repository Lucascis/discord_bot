#!/usr/bin/env node

/**
 * Discord Music Bot - Optimized Version
 *
 * Production-ready music bot with real-time progress tracking
 * Designed for scalability across thousands of servers
 *
 * Features:
 * - Real-time progress bars with smart intervals
 * - Interactive button controls
 * - Optimized resource usage
 * - Auto-cleanup and memory management
 *
 * Usage: node start-music-bot.js
 */

const fs = require('fs');
const path = require('path');

console.log('🎵 Discord Music Bot - Starting...');

// Check if optimized bot exists
const optimizedBotPath = path.join(__dirname, 'music-bot-optimized.js');

if (!fs.existsSync(optimizedBotPath)) {
    console.error('❌ Optimized music bot file not found!');
    console.error('Expected file: music-bot-optimized.js');
    process.exit(1);
}

// Check environment variables
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_APPLICATION_ID) {
    console.error('❌ Missing required environment variables!');
    console.error('Please ensure .env file contains:');
    console.error('- DISCORD_TOKEN');
    console.error('- DISCORD_APPLICATION_ID');
    process.exit(1);
}

console.log('✅ Environment check passed');
console.log('🚀 Loading optimized music bot...');

// Load and start the optimized bot
require('./music-bot-optimized.js');
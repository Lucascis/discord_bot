import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test'
    },
    // No setupFiles needed - tests use mocks
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  },
  resolve: {
    alias: {
      '@discord-bot/database': path.resolve(__dirname, '../database/src'),
      '@discord-bot/logger': path.resolve(__dirname, '../logger/src'),
      '@discord-bot/config': path.resolve(__dirname, '../config/src'),
    }
  }
});

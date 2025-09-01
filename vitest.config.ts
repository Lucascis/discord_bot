import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Make workspace package resolvable during tests without prebuild
      '@discord-bot/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@discord-bot/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
      '@discord-bot/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
    },
  },
});

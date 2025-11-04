import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
      ],
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      '@discord-bot/database': path.resolve(__dirname, '../packages/database/src/index.ts'),
      '@discord-bot/logger': path.resolve(__dirname, '../packages/logger/src/index.ts'),
      '@discord-bot/config': path.resolve(__dirname, '../packages/config/src/index.ts'),
    },
  },
});

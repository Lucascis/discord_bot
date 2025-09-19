import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      threshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks', // Vitest 2.x default for better stability
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  },
  resolve: {
    alias: {
      '@discord-bot/database': path.resolve(__dirname, 'packages/database/src'),
      '@discord-bot/logger': path.resolve(__dirname, 'packages/logger/src'),
      '@discord-bot/config': path.resolve(__dirname, 'packages/config/src'),
      '@discord-bot/commands': path.resolve(__dirname, 'packages/commands/src'),
      // Gateway src aliases
      '../src/errors.js': path.resolve(__dirname, 'gateway/src/errors.ts'),
      '../src/ui.js': path.resolve(__dirname, 'gateway/src/ui.ts'),
      '../src/flags.js': path.resolve(__dirname, 'gateway/src/flags.ts'),
      '../src/util.js': path.resolve(__dirname, 'gateway/src/util.ts')
    }
  }
});
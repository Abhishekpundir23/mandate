import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['integrations/cli/**/*.test.ts'],
    exclude: ['dist-cli/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});

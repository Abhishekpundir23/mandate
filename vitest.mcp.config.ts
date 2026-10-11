import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['integrations/mcp/**/*.test.ts'],
    exclude: ['dist-mcp/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});

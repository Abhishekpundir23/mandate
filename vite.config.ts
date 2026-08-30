import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    setupFiles: './src/test/setup.ts',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      thresholds: {
        'src/domain/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/mandate/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/runtime/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/sandbox/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/evidence/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/benchmark/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});

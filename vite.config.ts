import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/')
            || id.includes('/node_modules/react-dom/')
            || id.includes('/node_modules/scheduler/')) return 'vendor-react';
          if (id.includes('/node_modules/zod/')) return 'vendor-zod';
          return undefined;
        },
      },
    },
  },
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

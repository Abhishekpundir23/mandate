import { readFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

function securityModuleReceipts(): Plugin {
  const root = resolve('.');
  const sourceRoot = resolve('src');
  const htmlEntry = resolve('index.html');
  const executableExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
  const cleanId = (id: string) => id.split('?')[0] ?? id;
  const portable = (file: string) => relative(root, file).split(sep).join('/');
  return {
    name: 'security-module-receipts',
    generateBundle(_options, bundle) {
      const modules = new Set<string>();
      const html = readFileSync(htmlEntry, 'utf8');
      const htmlModuleSources = [...html.matchAll(/<script\b([^>]*)>/giu)].flatMap((match) => {
        const attributes = match[1] ?? '';
        const type = /\btype\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]?.trim().toLowerCase();
        const source = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1];
        return type === 'module' && source !== undefined ? [source] : [];
      });
      const entries = new Set(htmlModuleSources
        .map((source) => cleanId(resolve(root, source.startsWith('/') ? source.slice(1) : source)))
        .filter((file) => (file === sourceRoot || file.startsWith(`${sourceRoot}${sep}`))
          && executableExtensions.has(extname(file)))
        .map(portable));
      // Rollup may tree-shake an effect-free HTML module entry out of every
      // emitted chunk. It remains a runtime entry and already has a source
      // analysis receipt, so retain the entry itself in the bundle receipt
      // inventory even when its generated chunk is empty.
      for (const entry of entries) modules.add(entry);
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules ?? {})) {
          const file = cleanId(id);
          if (file === undefined || !(file === sourceRoot || file.startsWith(`${sourceRoot}${sep}`))) continue;
          if (!executableExtensions.has(extname(file))) continue;
          modules.add(portable(file));
        }
      }
      const chunks = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((output) => output.fileName)
        .sort();
      this.emitFile({
        type: 'asset',
        fileName: 'security-module-receipts.json',
        source: `${JSON.stringify({
          version: 3,
          html: portable(htmlEntry),
          entries: [...entries].sort(),
          modules: [...modules].sort(),
          chunks,
        }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), securityModuleReceipts()],
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
    exclude: [...configDefaults.exclude, 'e2e/**', 'integrations/**'],
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

import { build } from 'esbuild';

await build({
  entryPoints: ['integrations/cli/main.ts'],
  outfile: 'dist-cli/mandate.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
});

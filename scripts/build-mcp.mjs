import { build } from 'esbuild';

await build({
  entryPoints: ['integrations/mcp/cli.ts'],
  outfile: 'dist-mcp/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
});

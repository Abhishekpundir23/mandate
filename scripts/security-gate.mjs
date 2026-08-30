/* global console */
import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import { scanBuiltAssets } from './security-built-policy.mjs';
import { scanSourceFiles } from './security-source-scan.mjs';

const sourceRoot = resolve('src');
const distRoot = resolve('dist');

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Security gate rejects symlink asset ${relative('.', path)}.`);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

const sourceFiles = (await filesUnder(sourceRoot)).filter((file) =>
  ['.ts', '.tsx'].includes(extname(file))
    && !file.includes('.test.')
    && !file.startsWith(join(sourceRoot, 'test')));
const sourceResult = await scanSourceFiles(sourceFiles, sourceRoot, resolve('tsconfig.app.json'));
const assetCounts = await scanBuiltAssets(distRoot, filesUnder);

console.log(`Structural security gate passed: ${sourceResult.sourceFileCount} production TS/TSX files, closed-world origin/effect policy.`);
console.log(`Host effect report: ${sourceResult.effectReport}`);
console.log(`Built asset gate passed: ${JSON.stringify(assetCounts)}, strict CSP/local references/zero network primitives, documented React and Zod vendor allowlists.`);

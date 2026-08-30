/* global console */
import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import { scanBuiltAssets } from './security-built-policy.mjs';
import { collectHtmlRuntimeSourceGraph } from './security-source-inventory.mjs';
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

const graph = await collectHtmlRuntimeSourceGraph(resolve('index.html'), sourceRoot);
const analyzedSourceFiles = (await filesUnder(sourceRoot)).filter((file) =>
  ['.ts', '.tsx'].includes(extname(file))
    && !file.includes('.test.')
    && !file.startsWith(join(sourceRoot, 'test')));
const sourceResult = await scanSourceFiles(analyzedSourceFiles, sourceRoot, resolve('tsconfig.app.json'));
const analysisReceipts = new Set(sourceResult.sourceReceipts);
const missingReceipts = graph.receipts.filter((receipt) => !analysisReceipts.has(receipt));
if (missingReceipts.length > 0) {
  throw new Error(`Runtime source graph has no analysis receipt for ${missingReceipts.join(', ')}.`);
}
const builtResult = await scanBuiltAssets(distRoot, filesUnder, graph);

console.log(`Structural security gate passed: entries=${graph.entries.join(',')}; analysis-receipts=${sourceResult.sourceFileCount}; runtime-receipts=${graph.receipts.length}; bundle-receipts=${builtResult.bundleSourceReceiptCount}; closed-world origin/effect policy.`);
console.log(`Host effect report: ${sourceResult.effectReport}`);
console.log(`Built asset gate passed: ${JSON.stringify(builtResult.assetCounts)}, strict CSP/local references/zero network primitives, documented React and Zod vendor allowlists.`);

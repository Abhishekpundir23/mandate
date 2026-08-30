/* global console */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import istanbulCoverage from 'istanbul-lib-coverage';

const { createCoverageMap } = istanbulCoverage;

const requiredDirectories = ['domain', 'mandate', 'runtime', 'sandbox', 'evidence', 'benchmark'];
const raw = JSON.parse(await readFile('coverage/coverage-final.json', 'utf8'));
const fullMap = createCoverageMap(raw);
let failed = false;

console.log('\nRequired source-directory coverage');
console.log('| Directory | Statements | Branches | Functions | Lines |');
console.log('| --- | ---: | ---: | ---: | ---: |');

for (const directory of requiredDirectories) {
  const marker = `${resolve('src', directory)}/`;
  const directoryMap = createCoverageMap({});
  for (const file of fullMap.files()) {
    if (file.startsWith(marker)) directoryMap.addFileCoverage(fullMap.fileCoverageFor(file));
  }
  if (directoryMap.files().length === 0) {
    throw new Error(`Coverage is missing src/${directory}.`);
  }
  const summary = directoryMap.getCoverageSummary();
  const values = [
    summary.statements.pct,
    summary.branches.pct,
    summary.functions.pct,
    summary.lines.pct,
  ];
  console.log(`| src/${directory} | ${values.map((value) => `${value.toFixed(2)}%`).join(' | ')} |`);
  if (values.some((value) => value < 90)) failed = true;
}

if (failed) {
  throw new Error('Every required coverage metric must be at least 90% independently.');
}

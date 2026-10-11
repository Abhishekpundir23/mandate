import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import process from 'node:process';

const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html']);
const excluded =
  /^(?:node_modules|dist(?:-[^/]+)?|coverage|docs|tmp|test-results|playwright-report)\//;
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((path) => extensions.has(extname(path)) && !excluded.test(path));
const groups = {};
for (const path of files) {
  const group =
    path.includes('.test.') || path.startsWith('e2e/')
      ? 'tests'
      : path.startsWith('src/')
        ? 'browser-and-sdk'
        : path.startsWith('integrations/')
          ? 'integrations'
          : 'tooling-and-config';
  const text = readFileSync(path, 'utf8');
  const lines = text === '' ? [] : text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  const previous = groups[group] ?? { files: 0, physical: 0, nonblank: 0 };
  groups[group] = {
    files: previous.files + 1,
    physical: previous.physical + lines.length,
    nonblank: previous.nonblank + lines.filter((line) => line.trim() !== '').length,
  };
}
const totals = Object.values(groups).reduce(
  (total, item) => ({
    files: total.files + item.files,
    physical: total.physical + item.physical,
    nonblank: total.nonblank + item.nonblank,
  }),
  { files: 0, physical: 0, nonblank: 0 },
);
process.stdout.write(
  JSON.stringify(
    {
      method:
        'Git-tracked TS/TSX/JS/MJS/CJS/CSS/HTML; dependencies, generated output, docs and JSON excluded',
      ...totals,
      groups,
    },
    null,
    2,
  ) + '\n',
);

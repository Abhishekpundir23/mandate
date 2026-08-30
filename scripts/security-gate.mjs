/* global console */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

const sourceFiles = (await filesUnder('src')).filter((file) =>
  ['.ts', '.tsx'].includes(extname(file))
    && !file.includes('.test.')
    && !file.startsWith(join('src', 'test')));

const sourceDenials = [
  ['network API', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|navigator\.sendBeacon/u],
  ['external endpoint', /https?:\/\//u],
  ['browser persistence', /\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/u],
  ['dynamic execution', /\beval\s*\(|\bnew\s+Function\b/u],
  ['unsafe HTML', /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/u],
  ['navigation API', /\bwindow\.open\s*\(|\blocation\.(?:assign|replace)\s*\(/u],
  ['form submission', /<form\b|\.requestSubmit\s*\(|\.submit\s*\(/u],
  ['secret material', /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b/u],
];

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const [label, pattern] of sourceDenials) {
    if (pattern.test(source)) throw new Error(`${relative('.', file)} contains forbidden ${label}.`);
  }
}

const bundleFiles = (await filesUnder('dist')).filter((file) => extname(file) === '.js');
if (bundleFiles.length === 0) throw new Error('Production bundle is missing; run the build first.');
const bundle = (await Promise.all(bundleFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const fetchCount = bundle.match(/\bfetch\s*\(/gu)?.length ?? 0;
if (fetchCount !== 1
  || !bundle.includes('relList')
  || !bundle.includes('modulepreload')
  || !bundle.includes('fetch(e.href,n)')) {
  throw new Error('Production fetch allowlist permits only Vite module-preload fallback fetch.');
}

for (const pattern of [
  /\b(?:XMLHttpRequest|WebSocket|EventSource)\b|navigator\.sendBeacon/u,
  /\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b/u,
]) {
  if (pattern.test(bundle)) throw new Error(`Production bundle contains forbidden pattern ${pattern}.`);
}

const urlLiterals = bundle.match(/https?:\/\/[^\s"'`\\]+/gu) ?? [];
const allowedMetadata = [
  /^https:\/\/react\.dev\/errors\//u,
  /^https?:\/\/www\.w3\.org\//u,
  /^https?:\/\/json-schema\.org\//u,
  /^http:\/\/\[\$\{e\}\]/u,
];
const disallowedUrls = [...new Set(urlLiterals.filter((url) =>
  !allowedMetadata.some((pattern) => pattern.test(url))))];
if (disallowedUrls.length > 0) {
  throw new Error(`Production bundle contains non-diagnostic URL metadata: ${disallowedUrls.join(', ')}`);
}

console.log(`Security gate passed: ${sourceFiles.length} source files denied product egress/storage/secrets/dynamic HTML/navigation/form APIs.`);
console.log(`Bundle gate passed: ${bundleFiles.length} JS bundle, one Vite module-preload fetch, diagnostic metadata allowlist only.`);

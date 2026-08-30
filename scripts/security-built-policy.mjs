import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

function occurrences(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

const allowedDiagnosticUrls = [
  /^https:\/\/react\.dev\/errors\//u,
  /^https?:\/\/www\.w3\.org\//u,
  /^https?:\/\/json-schema\.org\//u,
  /^http:\/\/\[\$\{[a-zA-Z]\}\]/u,
];

async function scanTextAsset(file, text) {
  const name = basename(file);
  const urls = text.match(/https?:\/\/[^\s"'`\\]+/gu) ?? [];
  const unknownUrls = [...new Set(urls.filter((url) =>
    !allowedDiagnosticUrls.some((pattern) => pattern.test(url))))];
  if (unknownUrls.length > 0) throw new Error(`${name} contains forbidden endpoint ${unknownUrls.join(', ')}.`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b/u.test(text)) {
    throw new Error(`${name} contains secret-shaped material.`);
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|sendBeacon\s*\(|\b(?:localStorage|sessionStorage|indexedDB|caches)\b/u.test(text)) {
    throw new Error(`${name} contains a forbidden runtime capability.`);
  }
  const applicationAsset = name.startsWith('index-') || name.endsWith('.html') || name.endsWith('.map');
  if (applicationAsset
    && /\beval\s*\(|\bFunction\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|\.submit\s*\(|requestSubmit\s*\(/u.test(text)) {
    throw new Error(`${name} contains a forbidden application sink.`);
  }
  if (name.startsWith('vendor-zod-')) {
    const functions = occurrences(text, /\bFunction\s*\(/gu);
    if (functions !== 1 || !text.includes('jitless')) {
      throw new Error(`${name} violates the documented Zod jitless feature-detection allowlist.`);
    }
  }
}

async function verifyLocalReference(file, reference, distRoot) {
  const clean = reference.split(/[?#]/u)[0];
  if (clean === '' || clean.startsWith('#')) return;
  if (/^(?:data:|https?:|\/\/)/u.test(clean)) throw new Error(`${basename(file)} has remote or embedded reference ${reference}.`);
  const target = clean.startsWith('/') ? join(distRoot, clean.slice(1)) : resolve(dirname(file), clean);
  if (!target.startsWith(`${distRoot}/`)) throw new Error(`${basename(file)} reference escapes dist: ${reference}.`);
  await stat(target).catch(() => {
    throw new Error(`${basename(file)} references missing local asset ${reference}.`);
  });
}

export async function scanBuiltAssets(distRoot, filesUnder) {
  const files = await filesUnder(distRoot);
  const allowed = new Set(['.html', '.js', '.css', '.map', '.woff', '.woff2']);
  const counts = new Map();
  for (const file of files) {
    const extension = extname(file);
    if (!allowed.has(extension)) throw new Error(`Security gate rejects unknown built asset ${relative('.', file)}.`);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
    const bytes = await readFile(file);
    if (extension === '.woff' || extension === '.woff2') {
      const magic = bytes.subarray(0, 4).toString('ascii');
      const expected = extension === '.woff' ? 'wOFF' : 'wOF2';
      if (magic !== expected) throw new Error(`${basename(file)} has invalid font magic.`);
      continue;
    }
    const text = bytes.toString('utf8');
    await scanTextAsset(file, text);
    if (extension === '.html') {
      const cspMatch = text.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=(?:"([^"]*)"|'([^']*)')/iu);
      const csp = cspMatch?.[1] ?? cspMatch?.[2];
      for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'"]) {
        if (!csp?.includes(directive)) throw new Error(`Built HTML is missing strict CSP directive ${directive}.`);
      }
      const references = [...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/giu)].map((match) => match[1]);
      await Promise.all(references.map((reference) => verifyLocalReference(file, reference, distRoot)));
    }
    if (extension === '.css') {
      const references = [...text.matchAll(/url\((?:["'])?([^"')]+)(?:["'])?\)/giu)].map((match) => match[1]);
      await Promise.all(references.map((reference) => verifyLocalReference(file, reference, distRoot)));
    }
  }
  if ((counts.get('.html') ?? 0) !== 1 || (counts.get('.js') ?? 0) < 3 || (counts.get('.css') ?? 0) !== 1) {
    throw new Error(`Built asset inventory is unexpected: ${JSON.stringify(Object.fromEntries(counts))}.`);
  }
  return Object.fromEntries([...counts].sort());
}

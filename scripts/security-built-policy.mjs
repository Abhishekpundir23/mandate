import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import { JSDOM } from 'jsdom';

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
  const trustedVendor = name.startsWith('vendor-react-') || name.startsWith('vendor-zod-');
  const applicationAsset = !trustedVendor && ['.js', '.html', '.map'].includes(extname(file));
  const navigationAsset = !trustedVendor
    && ['.js', '.html', '.map'].includes(extname(file));
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
  if (navigationAsset
    && /(?:\b(?:window|globalThis|document)\s*\.\s*)?\blocation\s*(?:\.\s*(?:assign|replace)\s*\(|(?:\.\s*href)?\s*=)|\b(?:window|globalThis)\s*\.\s*open\s*\(|(?:\b(?:window|globalThis)\s*\.\s*)?\bhistory\s*\.\s*(?:pushState|replaceState)\s*\(/u.test(text)) {
    throw new Error(`${name} contains a forbidden navigation capability.`);
  }
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

const requiredCsp = new Map([
  ['default-src', ["'none'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['img-src', ["'self'"]],
  ['connect-src', ["'none'"]],
  ['form-action', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['object-src', ["'none'"]],
  ['frame-src', ["'none'"]],
  ['worker-src', ["'none'"]],
]);

function validateHtmlPolicy(document) {
  const privileged = document.querySelector('iframe, object, embed, base, template, [srcdoc]');
  if (privileged !== null) {
    throw new Error(`Built HTML contains forbidden embedded document or privileged element ${privileged.tagName.toLowerCase()}.`);
  }
  const refresh = [...document.querySelectorAll('meta[http-equiv]')].find((element) =>
    element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh');
  if (refresh !== undefined) throw new Error('Built HTML contains forbidden meta refresh navigation.');

  const cspNodes = [...document.querySelectorAll('meta[http-equiv]')].filter((element) =>
    element.getAttribute('http-equiv')?.trim().toLowerCase() === 'content-security-policy');
  if (cspNodes.length !== 1 || cspNodes[0].parentElement !== document.head) {
    throw new Error('Built HTML must contain exactly one Content-Security-Policy meta as a direct child of head.');
  }
  const cspNode = cspNodes[0];
  const precedingActive = [...document.head.children]
    .slice(0, [...document.head.children].indexOf(cspNode))
    .find((element) => ['BASE', 'EMBED', 'IFRAME', 'LINK', 'OBJECT', 'SCRIPT', 'STYLE'].includes(element.tagName));
  if (precedingActive !== undefined) {
    throw new Error(`Built HTML Content-Security-Policy must precede active or resource element ${precedingActive.tagName.toLowerCase()}.`);
  }

  const directives = new Map();
  for (const segment of (cspNode.getAttribute('content') ?? '').split(';')) {
    const tokens = segment.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    if (directives.has(name)) throw new Error(`Built HTML has duplicate CSP directive ${name}.`);
    directives.set(name, values);
  }
  if (directives.size !== requiredCsp.size) {
    throw new Error('Built HTML CSP must contain only the exact approved directive budget.');
  }
  for (const [name, expectedValues] of requiredCsp) {
    const values = directives.get(name);
    if (values === undefined || values.length !== expectedValues.length
      || values.some((value, index) => value !== expectedValues[index])) {
      throw new Error(`Built HTML is missing exact strict CSP directive ${name} ${expectedValues.join(' ')}.`);
    }
  }
}

function validateSourceReceipts(file, bytes, graph) {
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${basename(file)} is not valid JSON.`);
  }
  const entries = payload?.entries;
  const modules = payload?.modules;
  const chunks = payload?.chunks;
  if (payload?.version !== 3 || payload?.html !== graph.html || !Array.isArray(entries)
    || entries.some((value) => typeof value !== 'string') || !Array.isArray(modules)
    || modules.some((value) => typeof value !== 'string') || !Array.isArray(chunks)
    || chunks.some((value) => typeof value !== 'string')) {
    throw new Error(`${basename(file)} has an invalid closed-world receipt schema.`);
  }
  const sortedEntries = [...entries].sort();
  if (new Set(sortedEntries).size !== sortedEntries.length
    || sortedEntries.some((value, index) => value !== entries[index])) {
    throw new Error(`${basename(file)} runtime entry receipts must be unique and sorted.`);
  }
  const expectedEntries = [...graph.entries].sort();
  const bundleOnlyEntries = sortedEntries.filter((value) => !expectedEntries.includes(value));
  const sourceOnlyEntries = expectedEntries.filter((value) => !sortedEntries.includes(value));
  if (bundleOnlyEntries.length > 0 || sourceOnlyEntries.length > 0) {
    throw new Error(`${basename(file)} disagrees with HTML runtime entries: bundle-only=${bundleOnlyEntries.join(',') || '<none>'}; source-only=${sourceOnlyEntries.join(',') || '<none>'}.`);
  }
  const sorted = [...modules].sort();
  if (new Set(sorted).size !== sorted.length || sorted.some((value, index) => value !== modules[index])) {
    throw new Error(`${basename(file)} module receipts must be unique and sorted.`);
  }
  const prohibited = sorted.find((value) => value.startsWith('src/test/') || /\.test\.[^.]+$/u.test(value));
  if (prohibited !== undefined) {
    throw new Error(`${basename(file)} contains reachable test-scoped production module ${prohibited}.`);
  }
  const expected = [...graph.receipts].sort();
  const missingAnalysis = sorted.filter((value) => !expected.includes(value));
  const missingBundle = expected.filter((value) => !sorted.includes(value));
  if (missingAnalysis.length > 0 || missingBundle.length > 0) {
    throw new Error(`${basename(file)} disagrees with source analysis receipts: bundle-only=${missingAnalysis.join(',') || '<none>'}; source-only=${missingBundle.join(',') || '<none>'}.`);
  }
  const sortedChunks = [...chunks].sort();
  if (new Set(sortedChunks).size !== sortedChunks.length
    || sortedChunks.some((value, index) => value !== chunks[index])
    || sortedChunks.some((value) => extname(value) !== '.js' || value.startsWith('/') || value.split('/').includes('..'))) {
    throw new Error(`${basename(file)} executable chunk receipts must be safe, unique, and sorted.`);
  }
  return { entryCount: sortedEntries.length, moduleCount: sorted.length, chunks: sortedChunks };
}

export async function scanBuiltAssets(distRoot, filesUnder, graph) {
  const files = await filesUnder(distRoot);
  const allowed = new Set(['.html', '.js', '.css', '.map', '.woff', '.woff2']);
  const counts = new Map();
  const javascriptAssets = [];
  let bundleReceiptCounts;
  for (const file of files) {
    if (basename(file) === 'security-module-receipts.json') {
      if (bundleReceiptCounts !== undefined) throw new Error('Built output contains duplicate source receipt inventories.');
      bundleReceiptCounts = validateSourceReceipts(file, await readFile(file), graph);
      continue;
    }
    const extension = extname(file);
    if (!allowed.has(extension)) throw new Error(`Security gate rejects unknown built asset ${relative('.', file)}.`);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
    if (extension === '.js') javascriptAssets.push(relative(distRoot, file));
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
      const document = new JSDOM(text).window.document;
      validateHtmlPolicy(document);
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
  if (bundleReceiptCounts === undefined) throw new Error('Built output is missing security-module-receipts.json.');
  const sortedJavascriptAssets = javascriptAssets.sort();
  const unreceiptedJavascript = sortedJavascriptAssets.filter((value) => !bundleReceiptCounts.chunks.includes(value));
  const missingJavascript = bundleReceiptCounts.chunks.filter((value) => !sortedJavascriptAssets.includes(value));
  if (unreceiptedJavascript.length > 0 || missingJavascript.length > 0) {
    throw new Error(`Built JavaScript asset inventory disagrees with bundler chunk receipts: unreceipted=${unreceiptedJavascript.join(',') || '<none>'}; missing=${missingJavascript.join(',') || '<none>'}.`);
  }
  return {
    assetCounts: Object.fromEntries([...counts].sort()),
    bundleEntryReceiptCount: bundleReceiptCounts.entryCount,
    bundleSourceReceiptCount: bundleReceiptCounts.moduleCount,
  };
}

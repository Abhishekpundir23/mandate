import { realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const allowedBareImports = new Set(['react', 'react-dom/client', 'zod']);

export const ambientRoots = new Set([
  'window', 'globalThis', 'self', 'document', 'navigator', 'location', 'history',
]);
export const safeAmbientPaths = new Set([
  'document.getElementById', 'globalThis.matchMedia', 'window.matchMedia',
  'window.setInterval', 'window.clearInterval',
]);
export const safeAmbientIdentifiers = new Set(['matchMedia']);
export const forbiddenProperties = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie',
  'eval', 'Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'open', 'assign', 'replace', 'pushState', 'replaceState', 'submit', 'requestSubmit',
  'contentWindow', 'defaultView', 'ownerDocument', 'require',
]);
export const receiverIndependentSinks = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie',
  'eval', 'Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'pushState', 'replaceState', 'submit', 'requestSubmit',
  'contentWindow', 'defaultView', 'ownerDocument', 'require',
]);
export const forbiddenGlobalIdentifiers = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'eval', 'Function',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'location', 'history', 'navigator',
  'module', 'process', 'require',
]);
export const privilegedTags = new Set([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
]);

function localImportCandidates(file, specifier) {
  const base = resolve(dirname(file), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, join(base, 'index.ts'), join(base, 'index.tsx')];
}

export async function assertSourceImport(file, specifier, sourceRoot) {
  if (!specifier.startsWith('.')) {
    if (!allowedBareImports.has(specifier)) {
      throw new Error(`${relative('.', file)} has forbidden production import ${specifier}.`);
    }
    return;
  }
  for (const candidate of localImportCandidates(file, specifier)) {
    try {
      const resolved = await realpath(candidate);
      if (!resolved.startsWith(`${sourceRoot}/`)) {
        throw new Error(`${relative('.', file)} import escapes src: ${specifier}.`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes('escapes src')) throw error;
    }
  }
  throw new Error(`${relative('.', file)} has unresolved local import ${specifier}.`);
}

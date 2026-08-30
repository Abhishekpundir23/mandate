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
  'constructor', '__proto__', 'prototype', 'getPrototypeOf', 'setPrototypeOf',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty', 'defineProperties',
]);
export const receiverIndependentSinks = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie',
  'eval', 'Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'pushState', 'replaceState', 'submit', 'requestSubmit',
  'contentWindow', 'defaultView', 'ownerDocument', 'require',
  'constructor', '__proto__', 'prototype', 'getPrototypeOf', 'setPrototypeOf',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty', 'defineProperties',
]);
export const forbiddenGlobalIdentifiers = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'eval', 'Function',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'location', 'history', 'navigator',
  'module', 'process', 'require', 'Reflect', 'Proxy',
]);
export const privilegedTags = new Set([
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form',
]);

// These exact, local validation/freezing sites read data descriptors or compare
// built-in prototypes without invoking getters or exposing ambient authority.
export const safeReflectionSites = new Set([
  'src/domain/schema.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/mandate/compiler.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/mandate/ledger.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/mandate/gate.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/benchmark/fixture-evaluator.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/evidence/receipt.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/runtime/runner-support.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/sandbox/execute.ts#deepFreeze#getOwnPropertyDescriptors',
  'src/domain/canonical.ts#normalizeUnknown#getPrototypeOf',
  'src/domain/canonical.ts#normalizeUnknown#prototype',
  'src/mandate/gate.ts#readExactDataRecord#getPrototypeOf',
  'src/mandate/gate.ts#readExactDataRecord#prototype',
  'src/mandate/gate.ts#readExactDataRecord#getOwnPropertyDescriptors',
  'src/mandate/gate.ts#readDenseDataArray#getPrototypeOf',
  'src/mandate/gate.ts#readDenseDataArray#prototype',
  'src/mandate/gate.ts#readDenseDataArray#getOwnPropertyDescriptors',
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

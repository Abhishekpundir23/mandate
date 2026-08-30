import { realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const allowedBareImports = new Set(['react', 'react-dom/client', 'zod']);

export const hostEffects = Object.freeze([
  'HOST_LOCAL_MUTATION',
  'HOST_UI_STATE',
  'HOST_TIMER',
  'HOST_VIEWPORT_READ',
  'HOST_DOM_MOUNT',
  'HOST_DOM_FOCUS',
  'HOST_DOM_SCROLL',
  'HOST_NETWORK',
  'HOST_STORAGE',
  'HOST_NAVIGATION',
  'HOST_FORM_SUBMIT',
  'HOST_UNSAFE_DOM_WRITE',
  'HOST_DYNAMIC_CODE',
  'HOST_UNKNOWN',
]);

export const forbiddenHostEffects = new Set([
  'HOST_NETWORK',
  'HOST_STORAGE',
  'HOST_NAVIGATION',
  'HOST_FORM_SUBMIT',
  'HOST_UNSAFE_DOM_WRITE',
  'HOST_DYNAMIC_CODE',
  'HOST_UNKNOWN',
]);

export const browserFacadePath = 'src/platform/browser-capabilities.tsx';

const browserFacadeBudget = new Set([
  'HOST_LOCAL_MUTATION',
  'HOST_UI_STATE',
  'HOST_TIMER',
  'HOST_VIEWPORT_READ',
  'HOST_DOM_MOUNT',
  'HOST_DOM_FOCUS',
  'HOST_DOM_SCROLL',
]);

const applicationBudget = new Set([
  'HOST_LOCAL_MUTATION',
  'HOST_UI_STATE',
]);

export const ambientRoots = new Set([
  'window',
  'globalThis',
  'self',
  'document',
  'navigator',
  'location',
  'history',
]);

export const forbiddenGlobalIdentifiers = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'eval',
  'Function',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'location',
  'history',
  'navigator',
  'module',
  'process',
  'require',
  'Proxy',
]);

export const privilegedTags = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'base',
  'meta',
  'link',
  'form',
]);

export const approvedMediaQueries = new Set([
  '(max-width: 899px)',
  '(min-width: 1200px)',
  '(prefers-reduced-motion: reduce)',
]);

export function moduleEffectBudget(file) {
  return relative('.', file) === browserFacadePath
    ? browserFacadeBudget
    : applicationBudget;
}

export function effectIsBudgeted(file, effect) {
  return moduleEffectBudget(file).has(effect);
}

function localImportCandidates(file, specifier) {
  const base = resolve(dirname(file), specifier);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.css`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
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

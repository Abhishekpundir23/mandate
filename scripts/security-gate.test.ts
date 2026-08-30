import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

async function runGate(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'mandate-security-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await cp('dist', join(root, 'dist'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'src', 'fixture.tsx'), source);
  await cp('tsconfig.app.json', join(root, 'tsconfig.app.json'));
  await cp('scripts/security-gate.mjs', join(root, 'scripts', 'security-gate.mjs'));
  await cp('scripts/security-assignment-analysis.mjs', join(root, 'scripts', 'security-assignment-analysis.mjs'));
  await cp('scripts/security-built-policy.mjs', join(root, 'scripts', 'security-built-policy.mjs'));
  await cp('scripts/security-source-policy.mjs', join(root, 'scripts', 'security-source-policy.mjs'));
  await cp('scripts/security-source-scan.mjs', join(root, 'scripts', 'security-source-scan.mjs'));
  await cp('scripts/security-type-analysis.mjs', join(root, 'scripts', 'security-type-analysis.mjs'));
  const policyPath = resolve('scripts/security-policy.mjs');
  try {
    await readFile(policyPath);
    await cp(policyPath, join(root, 'scripts', 'security-policy.mjs'));
  } catch {
    // The first RED intentionally runs against the pre-structural gate.
  }
  const result = spawnSync(process.execPath, ['scripts/security-gate.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function runStandaloneSecurityWithStaleBuild() {
  const root = await mkdtemp(join(tmpdir(), 'mandate-security-command-'));
  temporaryRoots.push(root);
  for (const path of [
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json',
    'tsconfig.node.json', 'vite.config.ts', 'index.html', 'src', 'scripts', 'dist',
  ]) {
    await cp(path, join(root, path), { recursive: true });
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'dist', 'stale.js'), `fetch('/stale-product-endpoint')`);
  const result = spawnSync('npm', ['run', 'test:security'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('structural security gate', () => {
  it.each([
    ['computed fetch', `globalThis['f' + 'etch']('/escape')`],
    ['computed eval', `globalThis['ev' + 'al']('escape')`],
    ['computed beacon', `navigator['send' + 'Beacon']('/escape')`],
    ['computed storage', `globalThis['local' + 'Storage'].setItem('x', 'y')`],
    ['computed innerHTML', `document.body['inner' + 'HTML'] = '<img>'`],
    ['computed location', `location['as' + 'sign']('/escape')`],
    ['computed form submission', `document.createElement('form')['sub' + 'mit']()`],
    ['ambient alias', `const authority = globalThis; const request = authority.fetch; request('/escape')`],
    ['ambient destructure', `const { fetch: request } = globalThis; request('/escape')`],
    ['Reflect escape', `Reflect.get(globalThis, 'fetch')('/escape')`],
    ['owner document escape', `const root = document.body; root.ownerDocument.defaultView.fetch('/escape')`],
    ['forbidden import', `import request from 'axios'; request('/escape')`],
    ['privileged JSX', `const node = <iframe src="/escape" />`],
    ['bare fetch alias', `const request = fetch; request('/escape')`],
    ['bare eval alias', `const execute = eval; execute('1')`],
    ['call-return ambient leak', `const expose = () => globalThis; expose().fetch('/escape')`],
    ['descriptor leak', `Object.getOwnPropertyDescriptor(globalThis, 'fetch')?.value('/escape')`],
    ['WebSocket constructor', `new WebSocket('ws://escape.invalid')`],
    ['XMLHttpRequest constructor', `new XMLHttpRequest()`],
    ['EventSource constructor', `new EventSource('/escape')`],
    ['Function constructor', `new Function('return 1')`],
    ['typed form submit', `const form = {} as HTMLFormElement; form.submit()`],
    ['typed form requestSubmit', `const form = {} as HTMLFormElement; form.requestSubmit()`],
    ['typed innerHTML assignment', `const element = {} as Element; element.innerHTML = '<img>'`],
    ['prototype submit call', `HTMLFormElement.prototype.submit.call({} as HTMLFormElement)`],
    ['nested unknown ambient property', `globalThis['notProvenSafe'].call(undefined)`],
    ['module require route', `module.require('node:https')`],
    ['node export star', `export * from 'node:https'`],
    ['forbidden re-export', `export { default as request } from 'axios'`],
    ['TypeScript import equals', `import http = require('node:https'); void http`],
    ['unknown call receives ambient', `const accept = (value: unknown) => value; accept(globalThis)`],
    ['bare forbidden reference', `const authority = WebSocket; void authority`],
    ['compound nested reflection escapes', `
      const safeRoot = () => ({ nested: () => document.body });
      Reflect.get(safeRoot().nested().ownerDocument.defaultView, 'fetch')('/escape');
      const prototype = Object.getPrototypeOf(safeRoot());
      Object.getOwnPropertyDescriptor(prototype, 'inner' + 'HTML')?.set?.call({}, '<img>');
      (() => {}).constructor('return 1')();
    `],
    ['nested Reflect return escape', `
      const safeRoot = () => ({ nested: () => document.body });
      Reflect.get(safeRoot().nested().ownerDocument.defaultView, 'fetch')('/escape');
    `],
    ['prototype descriptor optional setter escape', `
      const safeRoot = () => ({ label: 'local' });
      const prototype = Object.getPrototypeOf(safeRoot());
      Object.getOwnPropertyDescriptor(prototype, 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['function constructor escape', `(() => {}).constructor('return 1')()`],
    ['optional descriptor value call', `
      Object.getOwnPropertyDescriptor(globalThis, 'fetch')?.value?.('/escape');
    `],
    ['Proxy metaprogramming', `new Proxy({}, {})`],
    ['dynamic function constructor callee', `
      const key = 'constructor'.slice(0);
      const callable = (() => {}) as unknown as Record<string, (...args: string[]) => () => unknown>;
      callable[key]!('return 1')();
    `],
    ['destructured Object reflection aliases', `
      const root = { label: 'local' };
      const { getPrototypeOf: prototypeOf, getOwnPropertyDescriptor: describe } = Object;
      describe(prototypeOf(root), 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['assigned dynamic callable access', `
      const key = 'handler'.slice(0);
      const table: Record<string, (() => void) | undefined> = {};
      const member = table[key];
      member?.();
    `],
    ['returned dynamic callable access', `
      export function leak(table: Record<string, () => void>, key: string) { return table[key]; }
    `],
    ['optional dynamic callable access', `
      const key = 'handler'.slice(0);
      const table: Record<string, (() => void) | undefined> = {};
      table?.[key]?.();
    `],
    ['dynamic unknown access', `
      export function leak(table: Record<string, unknown>, key: string) { return table[key]; }
    `],
    ['unresolved Object element access', `
      declare const key: string;
      export const member = Object[key];
    `],
    ['nested reflection binding with default', `
      const source = { nested: Object };
      const { nested: { getOwnPropertyDescriptor: describe = () => undefined } = Object } = source;
      void describe;
    `],
    ['computed constructor binding', `
      const key = 'constructor' as const;
      const source = { constructor: () => undefined };
      const { [key]: build } = source;
      void build;
    `],
    ['generic indexed constructor helper', `
      function element<T, K extends keyof T>(source: T, key: K): T[K] { return source[key]; }
      type Callable = { (): void; constructor: (...args: string[]) => () => unknown };
      const source = (() => undefined) as unknown as Callable;
      const key = 'constructor'.slice(0) as keyof Callable;
      const execute = element(source, key);
      execute('return 1')();
    `],
    ['generic indexed Object descriptor helpers', `
      function element<T, K extends keyof T>(source: T, key: K): T[K] { return source[key]; }
      const prototypeKey = 'getPrototypeOf'.slice(0) as keyof ObjectConstructor;
      const descriptorKey = 'getOwnPropertyDescriptor'.slice(0) as keyof ObjectConstructor;
      const prototypeOf = element(Object, prototypeKey) as typeof Object.getPrototypeOf;
      const describe = element(Object, descriptorKey) as typeof Object.getOwnPropertyDescriptor;
      const root = { label: 'local' };
      describe(prototypeOf(root), 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['static destructuring assignment aliases', `
      let prototypeOf: typeof Object.getPrototypeOf;
      let describe: typeof Object.getOwnPropertyDescriptor;
      ({ getPrototypeOf: prototypeOf, getOwnPropertyDescriptor: describe } = Object);
      describe(prototypeOf({ label: 'local' }), 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['computed destructuring assignment aliases', `
      let prototypeOf: typeof Object.getPrototypeOf;
      let describe: typeof Object.getOwnPropertyDescriptor;
      const prototypeKey = 'getPrototypeOf'.slice(0);
      const descriptorKey = 'getOwnPropertyDescriptor'.slice(0);
      ({ [prototypeKey]: prototypeOf, [descriptorKey]: describe } = Object as any);
      describe(prototypeOf({ label: 'local' }), 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['nested default destructuring assignment alias', `
      let describe: typeof Object.getOwnPropertyDescriptor;
      const source = { reflection: Object };
      ({ reflection: { getOwnPropertyDescriptor: describe = () => undefined } = Object } = source);
      describe({}, 'inner' + 'HTML')?.set?.call({}, '<img>');
    `],
    ['array assignment from global Object', `
      let prototypeOf: typeof Object.getPrototypeOf;
      ([prototypeOf] = Object as unknown as readonly [typeof Object.getPrototypeOf]);
      prototypeOf({ label: 'local' });
    `],
    ['computed DOM write', `
      const root = document.getElementById('root')!;
      const key = 'innerHTML'.slice(0);
      (root as unknown as Record<string, string>)[key] = '<img>';
    `],
    ['computed DOM compound write', `
      const root = document.getElementById('root')!;
      const key = 'innerHTML'.slice(0);
      (root as unknown as Record<string, string>)[key] += '<img>';
    `],
    ['computed DOM update', `
      const root = document.getElementById('root')!;
      const key = 'innerHTML'.slice(0);
      ++(root as unknown as Record<string, number>)[key];
    `],
    ['aliased DOM receiver write', `
      const root = document.getElementById('root')!;
      const alias = root;
      const key = 'innerHTML'.slice(0);
      (alias as unknown as Record<string, string>)[key] = '<img>';
    `],
    ['helper-returned DOM receiver write', `
      function root() { return document.getElementById('root')!; }
      const key = 'innerHTML'.slice(0);
      (root() as unknown as Record<string, string>)[key] = '<img>';
    `],
    ['reassigned DOM receiver write', `
      let root: unknown = {};
      root = document.getElementById('root')!;
      const key = 'innerHTML'.slice(0);
      (root as Record<string, string>)[key] = '<img>';
    `],
  ])('rejects %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/forbidden|security|ambient|import|privileged/i);
  });

  it('allows ordinary authority domain words and exact safe ambient uses', async () => {
    const result = await runGate(`
      const tokenBudget = 3;
      const endpointPolicy = 'no product endpoints';
      const root = document.getElementById('root');
      const mobile = matchMedia('(max-width: 899px)').matches;
      const timer = window.setInterval(() => undefined, 1);
      window.clearInterval(timer);
      const operation = 'submit';
      const sentence = 'submit is a domain operation, not a capability reference';
      export { endpointPolicy, mobile, operation, root, sentence, tokenBudget };
    `);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['history parameter', `export function countHistory(history: readonly string[]) { return history.length; }`],
    ['location parameter', `export function describeLocation(location: string) { return location.toUpperCase(); }`],
    ['navigator parameter', `export function nameNavigator(navigator: { readonly label: string }) { return navigator.label; }`],
    ['Reflect parameter', `
      export function readLocal(Reflect: { get: (value: { readonly label: string }, key: 'label') => string }) {
        return Reflect.get({ label: 'local' }, 'label');
      }
    `],
    ['constructor domain declaration', `
      const constructor = (value: string) => ({ value });
      export { constructor };
    `],
  ])('allows safe locally shadowed %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['ordinary local Record indexing', `
      const row: Record<string, string> = { label: 'safe' };
      const key = 'label'.slice(0);
      export const value = row[key];
    `],
    ['ordinary local Record write', `
      const row: Record<string, string> = { label: 'safe' };
      const key = 'label'.slice(0);
      row[key] = 'updated';
      export { row };
    `],
    ['ordinary unreassigned local let Record write', `
      let row: Record<string, string> = { label: 'safe' };
      const key = 'label'.slice(0);
      row[key] = 'updated';
      export { row };
    `],
    ['ordinary local object indexing and write', `
      const row = { label: 'safe', count: 1 };
      const key: keyof typeof row = 'label';
      row[key] = 'updated';
      export { row };
    `],
    ['ordinary local array indexing and write', `
      const values = ['safe'];
      const index = 0;
      values[index] = 'updated';
      export { values };
    `],
    ['ordinary nested destructuring', `
      const source: { label: string; nested?: { value?: number } } = { label: 'safe' };
      const { label, nested: { value = 1 } = {} } = source;
      export { label, value };
    `],
    ['local Object shadow with data indexing', `
      const Object: Record<string, string> = { label: 'safe' };
      const key = 'label'.slice(0);
      export const value = Object[key];
    `],
    ['local Reflect shadow with ordinary destructuring', `
      export function read(Reflect: { label: string }) { const { label } = Reflect; return label; }
    `],
    ['ordinary local destructuring assignments', `
      let label = '';
      let first = '';
      const source = { label: 'safe' };
      ({ label } = source);
      ([first] = ['safe']);
      export { first, label };
    `],
  ])('allows %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it('standalone public security command rebuilds before scanning and replaces stale dist', async () => {
    const result = await runStandaloneSecurityWithStaleBuild();

    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/vite .* building client environment/i);
    expect(result.output).toMatch(/Built asset gate passed/);
  });
});

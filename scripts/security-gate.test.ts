import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

async function runGateFiles(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'mandate-security-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await cp('dist', join(root, 'dist'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (const [sourcePath, source] of Object.entries(files)) {
    await mkdir(join(root, dirname(sourcePath)), { recursive: true });
    await writeFile(join(root, sourcePath), source);
  }
  if (!Object.hasOwn(files, 'src/main.tsx')) {
    const imports = Object.keys(files)
      .filter((path) => /^src\/.*\.tsx?$/u.test(path))
      .map((path) => `import './${path.slice('src/'.length).replace(/\.tsx?$/u, '')}';`)
      .join('\n');
    await writeFile(join(root, 'src/main.tsx'), `${imports}\nexport {};\n`);
  }
  if (!Object.hasOwn(files, 'index.html')) {
    await writeFile(join(root, 'index.html'), '<!doctype html><script type="module" src="/src/main.tsx"></script>\n');
  }
  const receiptModules = [...new Set([
    ...Object.keys(files).filter((path) => /^src\/.*\.tsx?$/u.test(path)),
    'src/main.tsx',
  ])].sort();
  const productionReceipt = JSON.parse(await readFile('dist/security-module-receipts.json', 'utf8')) as {
    chunks?: unknown;
  };
  expect(productionReceipt.chunks).toEqual(expect.arrayContaining([expect.stringMatching(/\.js$/u)]));
  await writeFile(join(root, 'dist/security-module-receipts.json'), `${JSON.stringify({
    version: 3,
    html: 'index.html',
    entries: ['src/main.tsx'],
    modules: receiptModules,
    chunks: productionReceipt.chunks,
  }, null, 2)}\n`);
  await cp('tsconfig.app.json', join(root, 'tsconfig.app.json'));
  await cp('scripts/security-gate.mjs', join(root, 'scripts', 'security-gate.mjs'));
  await cp('scripts/security-assignment-analysis.mjs', join(root, 'scripts', 'security-assignment-analysis.mjs'));
  await cp('scripts/security-built-policy.mjs', join(root, 'scripts', 'security-built-policy.mjs'));
  await cp('scripts/security-source-policy.mjs', join(root, 'scripts', 'security-source-policy.mjs'));
  await cp('scripts/security-source-inventory.mjs', join(root, 'scripts', 'security-source-inventory.mjs'));
  await cp('scripts/security-source-scan.mjs', join(root, 'scripts', 'security-source-scan.mjs'));
  await cp('scripts/security-type-analysis.mjs', join(root, 'scripts', 'security-type-analysis.mjs'));
  const summariesPath = resolve('scripts/security-call-summaries.mjs');
  try {
    await readFile(summariesPath);
    await cp(summariesPath, join(root, 'scripts', 'security-call-summaries.mjs'));
  } catch {
    // Task 9 RED runs against the pre-summary scanner.
  }
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

async function runGate(source: string, sourcePath = 'src/main.tsx') {
  return runGateFiles({ [sourcePath]: source });
}

function runProductionGate() {
  const result = spawnSync(process.execPath, ['scripts/security-gate.mjs'], {
    cwd: resolve('.'),
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

async function runStandaloneSecurityWithFiles(
  files: Record<string, string>,
  mainPrefix = '',
  indexTail = '',
) {
  const root = await mkdtemp(join(tmpdir(), 'mandate-security-command-'));
  temporaryRoots.push(root);
  for (const path of [
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json',
    'tsconfig.node.json', 'vite.config.ts', 'index.html', 'src', 'scripts', 'dist',
  ]) {
    await cp(path, join(root, path), { recursive: true });
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (const [path, source] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  if (mainPrefix !== '') {
    const main = await readFile(join(root, 'src/main.tsx'), 'utf8');
    await writeFile(join(root, 'src/main.tsx'), `${mainPrefix}\n${main}`);
  }
  if (indexTail !== '') {
    const html = await readFile(join(root, 'index.html'), 'utf8');
    await writeFile(join(root, 'index.html'), `${html}\n${indexTail}\n`);
  }
  const result = spawnSync('npm', ['run', 'test:security'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(async () => {
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

  it('allows ordinary authority domain words without invoking host authority', async () => {
    const result = await runGate(`
      const tokenBudget = 3;
      const endpointPolicy = 'no product endpoints';
      const operation = 'submit';
      const sentence = 'submit is a domain operation, not a capability reference';
      export { endpointPolicy, operation, sentence, tokenBudget };
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
  }, 90_000);
});

const taskNineFalseGreens = [
  ['object destructuring member target', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    const source = { payload: '<img>' };
    ({ payload: (borrowedDom as unknown as Record<string, string>)[dynamicKey] } = source);
  `],
  ['array destructuring member target', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    [(borrowedDom as unknown as Record<string, string>)[dynamicKey]] = ['<img>'];
  `],
  ['nested default destructuring member target', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    const source: { nested?: { payload?: string } } = {};
    ({ nested: { payload: (borrowedDom as unknown as Record<string, string>)[dynamicKey] = '' } = {} } = source);
  `],
  ['for-of receiver laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    let target: unknown = { label: 'owned' };
    for (target of [borrowedDom]) {
      (target as Record<string, string>)[dynamicKey] = '<img>';
    }
  `],
  ['reassigned local factory laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    let factory: () => unknown = () => ({ label: 'owned' });
    factory = () => borrowedDom;
    const target = factory();
    (target as Record<string, string>)[dynamicKey] = '<img>';
  `],
  ['Object.assign onto borrowed DOM', `
    export {};
    declare const borrowedDom: Element;
    Object.assign(borrowedDom, { innerHTML: '<img>' });
  `],
  ['aliased Object.assign onto borrowed DOM', `
    export {};
    declare const borrowedDom: Element;
    const merge = Object.assign;
    merge(borrowedDom, { innerHTML: '<img>' });
  `],
  ['reassigned Object.assign alias onto borrowed DOM', `
    export {};
    declare const borrowedDom: Element;
    let merge: typeof Object.assign = (target) => target;
    merge = Object.assign;
    merge(borrowedDom, { innerHTML: '<img>' });
  `],
] as const;

const hostileWriteMatrix = [
  ['computed delete', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    delete (borrowedDom as unknown as Record<string, string | undefined>)[dynamicKey];
  `],
  ['array mutator', `
    export {};
    declare const borrowedArray: Element[];
    (borrowedArray as unknown as string[]).push('<img>');
  `],
  ['Map mutator', `
    export {};
    declare const borrowedMap: Map<string, string>;
    borrowedMap.set('innerHTML', '<img>');
  `],
  ['Set mutator', `
    export {};
    declare const borrowedSet: Set<string>;
    borrowedSet.add('<img>');
  `],
  ['Object.defineProperty', `
    export {};
    declare const borrowedDom: Element;
    Object.defineProperty(borrowedDom, 'innerHTML', { value: '<img>' });
  `],
  ['Object.defineProperties', `
    export {};
    declare const borrowedDom: Element;
    Object.defineProperties(borrowedDom, { innerHTML: { value: '<img>' } });
  `],
  ['Reflect.set', `
    export {};
    declare const borrowedDom: Element;
    Reflect.set(borrowedDom, 'innerHTML', '<img>');
  `],
  ['Reflect.defineProperty', `
    export {};
    declare const borrowedDom: Element;
    Reflect.defineProperty(borrowedDom, 'innerHTML', { value: '<img>' });
  `],
  ['Reflect.deleteProperty', `
    export {};
    declare const borrowedDom: Element;
    Reflect.deleteProperty(borrowedDom, 'innerHTML');
  `],
  ['closure-return laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    const make = () => () => borrowedDom;
    const target = make()();
    (target as unknown as Record<string, string>)[dynamicKey] = '<img>';
  `],
  ['argument laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    function identity<T>(value: T): T { return value; }
    const target = identity(borrowedDom);
    (target as unknown as Record<string, string>)[dynamicKey] = '<img>';
  `],
  ['conditional laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    const target = Math.random() > 2 ? { label: 'owned' } : borrowedDom;
    (target as unknown as Record<string, string>)[dynamicKey] = '<img>';
  `],
  ['container laundering', `
    export {};
    declare const borrowedDom: Element;
    declare const dynamicKey: string;
    const container = [borrowedDom];
    const target = container[0]!;
    (target as unknown as Record<string, string>)[dynamicKey] = '<img>';
  `],
  ['unknown local declaration call', `
    export {};
    declare function unresolved(value: unknown): unknown;
    unresolved({ label: 'data' });
  `],
  ['unknown constructor', `
    export {};
    declare const Build: new () => unknown;
    new Build();
  `],
  ['unknown tagged template', `
    export {};
    declare const tag: (parts: TemplateStringsArray) => string;
    tag\`value\`;
  `],
  ['unknown higher-order callback', `
    export {};
    declare const callback: (value: number) => void;
    [1].forEach(callback);
  `],
  ['ambient Object.create prototype', `
    export {};
    declare const borrowedDom: Element;
    const target = Object.create(borrowedDom) as Record<string, string>;
    target.label = 'unsafe';
  `],
  ['aliased accessor descriptor', `
    export {};
    declare const getter: () => string;
    const define = Object.defineProperty;
    const row = {};
    define(row, 'label', { get: getter });
  `],
  ['React ref value DOM write', `
    import { useRef } from 'react';
    export function Fixture() {
      const ref = useRef<Element | null>(null);
      if (ref.current !== null) ref.current.innerHTML = '<img>';
      return null;
    }
  `],
] as const;

const safeWriteMatrix = [
  ['finite local computed write', `
    const row = { label: 'safe' };
    const key = 'label' as const;
    row[key] = 'updated';
    export { row };
  `],
  ['local field named innerHTML', `
    const row = { innerHTML: 'inert data' };
    row.innerHTML = 'still inert';
    export { row };
  `],
  ['local compound and update writes', `
    const row = { count: 1 };
    row.count += 2;
    row.count++;
    export { row };
  `],
  ['local delete', `
    const row: { label?: string } = { label: 'safe' };
    delete row.label;
    export { row };
  `],
  ['object destructuring member target', `
    const target: Record<string, string> = { payload: '' };
    const dynamicKey = 'payload'.slice(0);
    ({ payload: target[dynamicKey] } = { payload: 'safe' });
    export { target };
  `],
  ['array destructuring member target', `
    const target: Record<string, string> = { first: '' };
    const dynamicKey = 'first'.slice(0);
    [target[dynamicKey]] = ['safe'];
    export { target };
  `],
  ['nested and rest local assignment', `
    let label = '';
    let rest: Record<string, string> = {};
    ({ nested: { label } = { label: 'fallback' }, ...rest } = {
      nested: { label: 'safe' },
      extra: 'data',
    });
    export { label, rest };
  `],
  ['for-of owned reassignment', `
    let row: Record<string, string> = { label: 'first' };
    for (row of [{ label: 'second' }]) row.label = 'updated';
    export { row };
  `],
  ['local Object.assign', `
    const row = { label: 'first' };
    Object.assign(row, { label: 'second' });
    export { row };
  `],
  ['aliased local Object.assign', `
    const merge = Object.assign;
    const row = { label: 'first' };
    merge(row, { label: 'second' });
    export { row };
  `],
  ['local data descriptor', `
    const row: { label?: string } = {};
    Object.defineProperty(row, 'label', { value: 'safe', enumerable: true });
    export { row };
  `],
  ['local Reflect.set', `
    const row = { label: 'first' };
    Reflect.set(row, 'label', 'second');
    export { row };
  `],
  ['local array and collection mutators', `
    const values = ['first'];
    const labels = new Set<string>();
    const rows = new Map<string, string>();
    values.push('second');
    labels.add('safe');
    rows.set('label', 'safe');
    export { labels, rows, values };
  `],
  ['null-prototype dictionary dynamic key', `
    const dictionary = Object.create(null) as Record<string, string>;
    declare const dynamicKey: string;
    dictionary[dynamicKey] = 'safe';
    export { dictionary };
  `],
  ['shadowed Object and Reflect', `
    function update(
      Object: { assign: <T extends object>(target: T, source: Partial<T>) => T },
      Reflect: { set: (target: { label: string }, key: 'label', value: string) => true },
    ) {
      const row = { label: 'first' };
      Object.assign(row, { label: 'second' });
      Reflect.set(row, 'label', 'third');
      return row;
    }
    export { update };
  `],
  ['analyzed higher-order callback', `
    const values = [1, 2];
    const labels = values.map((value) => String(value));
    export { labels };
  `],
  ['React ref cell assignment', `
    import { useRef } from 'react';
    export function Fixture() {
      const ref = useRef('first');
      ref.current = 'second';
      return null;
    }
  `],
] as const;

describe('closed-world origin and effect gate', () => {
  it.each(taskNineFalseGreens)('closes Task 8 false green: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/security|effect|origin|ambient|borrowed|unknown|forbidden/i);
  });

  it.each(hostileWriteMatrix)('rejects hostile channel: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/security|effect|origin|ambient|borrowed|unknown|forbidden/i);
  });

  it.each(safeWriteMatrix)('accepts safe channel: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects raw browser authority outside the capability facade', async () => {
    const result = await runGate(`
      export const root = document.getElementById('root');
    `);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/module effect budget|ambient|DOM_MOUNT/i);
  });

  it('accepts only the narrow browser facade ambient budget', async () => {
    const result = await runGate(`
      import type { ReactNode } from 'react';
      import { createRoot } from 'react-dom/client';
      export function mountApplication(app: ReactNode): void {
        const root = document.getElementById('root');
        if (root === null) throw new Error('missing root');
        createRoot(root).render(app);
      }
      export function reducedMotion(): boolean {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    `, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).toBe(0);
  });

  it('emits deterministic provenance for a rejected effect', async () => {
    const result = await runGate(`
      export {};
      declare const borrowedDom: Element;
      const merge = Object.assign;
      merge(borrowedDom, { innerHTML: '<img>' });
    `);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/provenance:/i);
    expect(result.output).toMatch(/borrowedDom.*Object\.assign|Object\.assign.*borrowedDom/is);
  });

  it('reports the complete production host-effect budget with no forbidden effects', () => {
    const result = runProductionGate();

    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/Host effect report:/);
    expect(result.output).toMatch(/HOST_DOM_MOUNT/);
    expect(result.output).toMatch(/HOST_VIEWPORT_READ/);
    expect(result.output).toMatch(/HOST_TIMER/);
    expect(result.output).toMatch(/HOST_DOM_FOCUS/);
    expect(result.output).toMatch(/HOST_DOM_SCROLL/);
    expect(result.output).toMatch(/forbidden=0/);
    expect(result.output).toMatch(/unknown=0/);
  }, 90_000);
});

const reviewFalseGreens: readonly [string, Record<string, string>][] = [
  ['for-of preserves borrowed element origin', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
let target: unknown = { label: 'owned' };
for (target of [borrowedDom]) {
  (target as Record<'innerHTML', string>).innerHTML = '<img>';
}`,
  }],
  ['array spread preserves borrowed element origin', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const source = [borrowedDom];
const spread = [...source];
const target = spread[0]!;
(target as unknown as Record<'innerHTML', string>).innerHTML = '<img>';`,
  }],
  ['nested flat preserves borrowed element origin', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const nested = [[borrowedDom]];
const flattened = nested.flat();
const target = flattened[0]!;
(target as unknown as Record<'innerHTML', string>).innerHTML = '<img>';`,
  }],
  ['concat arguments join into result content', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const safe = [{ label: 'owned' }];
const combined = safe.concat(borrowedDom as unknown as { label: string });
const target = combined[1]!;
(target as unknown as Record<'innerHTML', string>).innerHTML = '<img>';`,
  }],
  ['borrowed map receiver cannot gain an owned result brand', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element & { map(callback: (value: number) => number): Element };
const target = borrowedDom.map((value) => value + 1);
(target as unknown as Record<'innerHTML', string>).innerHTML = '<img>';`,
  }],
  ['conditional null-prototype certainty uses every path', {
    'src/fixture.ts': `export function poison(key: string, chooseDictionary: boolean) {
  const target: Record<string, { polluted?: boolean }> = chooseDictionary
    ? Object.create(null) as Record<string, { polluted?: boolean }>
    : {};
  target[key] = { polluted: true };
  return target;
}
poison('__proto__', false);`,
  }],
  ['owned values escape through unresolved boundaries', {
    'src/fixture.ts': `export function exposeAndMutate(accept: (value: { label: string }) => void): void {
  const local = { label: 'owned' };
  accept(local);
  local.label = 'mutated after escape';
}`,
  }],
  ['unknown tagged-template parameter emits unknown', {
    'src/fixture.ts': `export function render(tag: (parts: TemplateStringsArray) => string): string {
  return tag\`payload\`;
}`,
  }],
  ['facade cannot return a raw DOM root', {
    'src/platform/browser-capabilities.tsx': `export function leakRoot(): HTMLElement | null {
  return document.getElementById('root');
}`,
  }],
  ['facade cannot return a raw MediaQueryList', {
    'src/platform/browser-capabilities.tsx': `export function leakMedia(): MediaQueryList {
  return window.matchMedia('(max-width: 899px)');
}`,
  }],
  ['React ref spread preserves DOM-bearing current origin', {
    'src/fixture.tsx': `import { useRef } from 'react';
export function Fixture() {
  const ref = useRef<Element | null>(null);
  const wrapper = { ...ref };
  if (wrapper.current !== null) {
    (wrapper.current as unknown as Record<'innerHTML', string>).innerHTML = '<img>';
  }
  return null;
}`,
  }],
  ['dynamic DOM call remains ambient', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const method = 'setAttribute' as const;
borrowedDom[method]('data-host-write', '1');`,
  }],
  ['emitless Document declaration remains ambient', {
    'src/fixture.ts': `export {};
declare const document: Document;
document.body.insertAdjacentHTML('beforeend', '<img src=x>');`,
  }],
  ['emitless Navigator declaration remains ambient', {
    'src/fixture.ts': `export {};
declare const navigator: Navigator;
navigator.sendBeacon('/escape', 'payload');`,
  }],
  ['emitless History declaration remains ambient', {
    'src/fixture.ts': `export {};
declare const history: History;
history.pushState({}, '', '/escape');`,
  }],
  ['unknown callable interface emits unknown', {
    'src/fixture.ts': `export function invoke(channel: { (payload: string): void }): void {
  channel('payload');
}`,
  }],
  ['window.location.assign resolves navigation effect', {
    'src/fixture.ts': `window.location.assign('/escape');
export {};`,
  }],
  ['window.document.write resolves unsafe DOM effect', {
    'src/fixture.ts': `window.document.write('<main>replaced</main>');
export {};`,
  }],
  ['Reflect.set shares prototype-key validation', {
    'src/fixture.ts': `export function poison(key: string): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  Reflect.set(target, key, { polluted: true });
  return target;
}
poison('__proto__');`,
  }],
  ['Object.assign rejects resolved computed __proto__ sources', {
    'src/fixture.ts': `const target: Record<string, unknown> = {};
Object.assign(target, { ['__' + 'proto__']: { polluted: true } });
export { target };`,
  }],
  ['borrowed prototype cannot reach Function through constructor and call', {
    'src/fixture.ts': `const proto = Object.getPrototypeOf(() => undefined) as {
  constructor(source: string): { call(receiver: unknown): unknown };
};
proto.constructor('location.assign("/escape")').call(undefined);
export {};`,
  }],
  ['push and pop preserve ambient container content', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const values: unknown[] = [{ label: 'owned' }];
values.push(borrowedDom);
const target = values.pop()!;
(target as Record<'innerHTML', string>).innerHTML = '<img>';`,
  }],
  ['React callback declaration origin survives a safe warm-up call', {
    'src/fixture.tsx': `import type { RefCallback } from 'react';
function write(node: { outerHTML: string } | null): void {
  if (node !== null) node.outerHTML = '<main>replaced</main>';
}
write({ outerHTML: 'safe local' });
const ref: RefCallback<HTMLDivElement> = write;
export function Fixture() { return <div ref={ref}>content</div>; }`,
  }],
];

const reviewSafeFalsePositives: readonly [string, Record<string, string>][] = [
  ['finite literal-union key parameter', {
    'src/fixture.ts': `export function update(key: 'left' | 'right') {
  const row = { left: 'a', right: 'b' };
  row[key] = 'updated';
  return row;
}
update('left');`,
  }],
  ['finite conditional key', {
    'src/fixture.ts': `const row = { left: 'a', right: 'b' };
const key = true ? 'left' : 'right';
row[key] = 'updated';
export { row };`,
  }],
  ['receiver-branded local window.focus method', {
    'src/fixture.ts': `export function activate(window: { focus: () => void }): void {
  window.focus();
}`,
  }],
  ['receiver-branded local client.fetch method', {
    'src/fixture.ts': `export function read(client: { fetch: () => string }): string {
  return client.fetch();
}`,
  }],
  ['local constructor data field projection', {
    'src/fixture.ts': `const row = { constructor: 'ordinary data', label: 'safe' };
const { constructor: description } = row;
export { description };`,
  }],
  ['object rest remains owned after excluding ambient field', {
    'src/fixture.ts': `export {};
declare const borrowedDom: Element;
const source = { host: borrowedDom, safe: { label: 'first' } };
const { host, ...rest } = source;
rest.safe.label = 'second';
void host;`,
  }],
  ['nested rest remains fresh owned local data', {
    'src/fixture.ts': `const source = { nested: { label: 'safe' }, extra: 'data' };
const { nested: { label }, ...rest } = source;
rest.extra = label;
export { rest };`,
  }],
  ['bound analyzed local function remains callable', {
    'src/fixture.ts': `function add(left: number, right: number): number { return left + right; }
const addOne = add.bind(undefined, 1);
export const result = addOne(2);`,
  }],
  ['local class construction produces owned data', {
    'src/fixture.ts': `class Box { value = 1; }
const box = new Box();
box.value = 2;
export { box };`,
  }],
  ['map callback produces owned result content', {
    'src/fixture.ts': `const rows = [1, 2].map((value) => ({ value }));
rows[0]!.value = 3;
export { rows };`,
  }],
  ['nested closure mutates its captured fresh array', {
    'src/fixture.ts': `export function collect(): readonly number[] {
  const values: number[] = [];
  const append = (value: number): void => { values.push(value); };
  append(1);
  return values;
}`,
  }],
  ['React ref cell owns a local Map mutation boundary', {
    'src/fixture.tsx': `import { useCallback, useRef } from 'react';
export function useRegistry() {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  return useCallback((key: string, node: HTMLButtonElement | null): void => {
    if (node === null) nodes.current.delete(key);
    else nodes.current.set(key, node);
  }, []);
}`,
  }],
];

const facadeLeakForms: readonly [string, string][] = [
  ['raw exported value', `export const leaked: object = document.getElementById('root')!;`],
  ['widened function return', `export function leak(): object { return document.getElementById('root')!; }`],
  ['widened default export', `const leaked: object = document.getElementById('root')!; export default leaked;`],
  ['nested aggregate output', `export const leaked: { nested: object } = { nested: document.getElementById('root')! };`],
  ['closure return output', `export function leak(): () => object { const root = document.getElementById('root')!; return () => root; }`],
  ['class method output', `export class Leak { reveal(): object { return document.getElementById('root')!; } }`],
  ['aliased function output', `function reveal(): object { return document.getElementById('root')!; } export { reveal as leak };`],
  ['opaque React root output', `import { createRoot } from 'react-dom/client'; export function leak(): object { return createRoot(document.getElementById('root')!); }`],
  ['nested callable output', `export const api: { open(): object } = { open: () => window.matchMedia('(max-width: 899px)') };`],
  ['class static field output', `export class Leak { static raw: object = window.matchMedia('(max-width: 899px)'); }`],
  ['anonymous default class getter output', `export default class { get raw(): object { return window.matchMedia('(max-width: 899px)'); } }`],
  ['write-after-allocation output', `const api: { raw: object } = { raw: {} }; api.raw = window.matchMedia('(max-width: 899px)'); export { api };`],
  ['public string field cannot collide with hard-private field identity', `export class Leak { #raw: object = {}; '#raw': object = document.getElementById('root')!; }`],
  ['computed public method reveals hard-private capability', `export class Leak { #raw = document.getElementById('root')!; ['reveal'](): object { return this.#raw; } }`],
  ['finite computed public method reveals hard-private capability', `const reveal = 'reveal' as const; export class Leak { #raw = document.getElementById('root')!; [reveal](): object { return this.#raw; } }`],
  ['computed public field reveals hard-private capability', `export class Leak { #raw = document.getElementById('root')!; ['reveal'] = (): object => this.#raw; }`],
  ['same callable cannot hide behind a second non-callable field', `const fn = () => window.matchMedia('(max-width: 899px)').matches; export const api: { safe: () => boolean; hidden: object } = { safe: fn, hidden: fn };`],
  ['shadow Reflect.set transfers a host into its target', `export function leak(Reflect: { set(target: { raw: object }, key: 'raw', value: object): true }, host: HTMLElement): object { const output: { raw: object } = { raw: {} }; Reflect.set(output, 'raw', host); return output; }`],
  ['shadow Object.assign transfers a host source', `export function leak(Object: { assign<T extends object>(target: T, source: Partial<T>): T }, host: HTMLElement): object { const output: { raw: object } = { raw: {} }; Object.assign(output, { raw: host }); return output; }`],
  ['shadow Reflect.get preserves nested host origin', `export function leak(Reflect: { get(target: { node: HTMLElement }, key: 'node'): HTMLElement }, input: { node: HTMLElement }): object { return Reflect.get(input, 'node'); }`],
  ['function-local direct write transfers host origin', `export function leak(host: HTMLElement): object { const output: { raw: object } = { raw: {} }; output.raw = host; return output; }`],
  ['function-local computed write transfers host origin', `export function leak(host: HTMLElement): object { const output: { raw: object } = { raw: {} }; output['raw'] = host; return output; }`],
  ['function-local helper write mutates the passed target', `function mutate(target: { raw: object }, value: object): void { target.raw = value; } export function leak(host: HTMLElement): object { const output: { raw: object } = { raw: {} }; mutate(output, host); return output; }`],
  ['exported void callable writes a host into an earlier exported slot', `let leaked: object = {}; const host: object = document.getElementById('root')!; export { leaked }; export function expose(): void { leaked = host; }`],
];

const facadeSafeForms: readonly [string, string][] = [
  ['ambient scalar projection', `export function compact(): boolean { return window.matchMedia('(max-width: 899px)').matches; }`],
  ['DOM callback input does not leak out', `export function ref(): (node: HTMLElement | null) => void { return (node) => { node?.focus(); }; }`],
  ['nested operation callbacks stay opaque', `export const operations: { focus: (node: HTMLElement) => void } = { focus: (node) => node.focus() };`],
  ['local domain class named Node is inert', `class Node { label = 'local'; } export function make(): Node { return new Node(); }`],
  ['closure may consume ambient authority without returning it', `export function detach(): () => void { const media = window.matchMedia('(max-width: 899px)'); return () => media.removeEventListener('change', () => undefined); }`],
  ['nested scalar callback output', `export const api = { viewport: { matches: () => window.matchMedia('(max-width: 899px)').matches } };`],
  ['hard-private capture exposes scalar only', `export class SafeViewport { #media = window.matchMedia('(max-width: 899px)'); matches(): boolean { return this.#media.matches; } }`],
];

const mutationKeyHostiles: readonly [string, string][] = [
  ['direct dynamic key on prototype-bearing object', `export function poison(key: string) { const target: Record<string, unknown> = {}; target[key] = true; return target; } poison('__proto__');`],
  ['Object.assign alias with computed prototype key', `const assign = Object.assign; const target: Record<string, unknown> = {}; assign(target, { ['__' + 'proto__']: true }); export { target };`],
  ['Object.assign getter source', `const target = { value: 0 }; Object.assign(target, { get value() { return 1; } }); export { target };`],
  ['Object.assign spread source', `const source = { value: 1 }; const target = { value: 0 }; Object.assign(target, { ...source }); export { target };`],
  ['Object.defineProperty dynamic key', `export function poison(key: string) { const target: Record<string, unknown> = {}; Object.defineProperty(target, key, { value: true }); return target; } poison('__proto__');`],
  ['Object.defineProperties computed prototype key', `const target: Record<string, unknown> = {}; Object.defineProperties(target, { ['__' + 'proto__']: { value: true } }); export { target };`],
  ['Reflect.defineProperty dynamic key', `export function poison(key: string) { const target: Record<string, unknown> = {}; Reflect.defineProperty(target, key, { value: true }); return target; } poison('__proto__');`],
  ['Reflect.deleteProperty dynamic key', `export function poison(key: string) { const target: Record<string, unknown> = {}; Reflect.deleteProperty(target, key); return target; } poison('__proto__');`],
];

const mutationKeySafes: readonly [string, string][] = [
  ['direct finite union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; target[key] = 3; return target; }`],
  ['Object.assign finite conditional source key', `const target = { left: 1, right: 2 }; const key = true ? 'left' : 'right'; Object.assign(target, { [key]: 3 }); export { target };`],
  ['Object.assign prototype data on null-prototype target', `const target = Object.create(null) as Record<string, unknown>; Object.assign(target, { ['__' + 'proto__']: true }); export { target };`],
  ['Object.defineProperty finite union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; Object.defineProperty(target, key, { value: 3 }); return target; }`],
  ['Object.defineProperties data map', `const target = { left: 1, right: 2 }; Object.defineProperties(target, { left: { value: 3 }, right: { value: 4 } }); export { target };`],
  ['Reflect.set finite union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; Reflect.set(target, key, 3); return target; }`],
  ['Reflect.defineProperty finite union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; Reflect.defineProperty(target, key, { value: 3 }); return target; }`],
  ['Reflect.deleteProperty on null-prototype dictionary', `export function remove(key: string) { const owned = Object.create(null) as Record<string, unknown>; Reflect.deleteProperty(owned, key); return owned; }`],
  ['all-branch null-prototype conditional', `export function update(key: string, choose: boolean) { const target: Record<string, unknown> = choose ? Object.create(null) : Object.create(null); target[key] = true; return target; }`],
];

describe('Task 9 independent-review mechanism matrix', () => {
  it.each(reviewFalseGreens)('rejects reviewer false green: %s', async (_, files) => {
    const result = await runGateFiles(files);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/security|effect|origin|ambient|borrowed|unknown|forbidden|capability|prototype/i);
  });

  it.each(reviewSafeFalsePositives)('accepts reviewer safe control: %s', async (_, files) => {
    const result = await runGateFiles(files);

    expect(result.status, result.output).toBe(0);
  });

  it('fails closed deterministically for a bodyless declaration instead of crashing', async () => {
    const result = await runGate(`export {};
declare function channel(payload: string): void;
channel('payload');`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
    expect(result.output).not.toMatch(/Cannot read properties|TypeError/i);
  });

  it('public security rejects a bundle-reachable test-named side-effect module without a source receipt', async () => {
    const result = await runStandaloneSecurityWithFiles({
      'src/escape.test.ts': `window.location.assign('/escape');\nexport {};\n`,
    }, `import './escape.test';`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/163 modules transformed/i);
    expect(result.output).toMatch(/reachable production module src\/escape\.test\.ts is test-scoped/i);
  }, 90_000);

  it('public security inventories scripts after raw-text style content', async () => {
    const result = await runStandaloneSecurityWithFiles({
      'public/escape.js': `document.body.innerHTML = '<main>escaped</main>';\n`,
    }, '', `<style><!--</style>
<script type="module" src="/escape.js"></script>
-->`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/runtime entry (?:escapes src|does not resolve)|forbidden application sink/i);
  }, 90_000);

  it('public security rejects HTML meta refresh navigation', async () => {
    const result = await runStandaloneSecurityWithFiles(
      {},
      '',
      '<meta http-equiv="refresh" content="0;url=/escape">',
    );

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/meta refresh navigation is forbidden/i);
  }, 90_000);

  it('public security rejects nested iframe srcdoc navigation', async () => {
    const currentHtml = await readFile('index.html', 'utf8');
    const result = await runStandaloneSecurityWithFiles({
      'index.html': currentHtml.replace(
        '<div id="root"></div>',
        `<div id="root"></div>
    <iframe srcdoc="&lt;meta http-equiv=&quot;refresh&quot; content=&quot;0;url=/escape&quot;&gt;"></iframe>`,
      ),
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/iframe|srcdoc|embedded document/i);
  }, 90_000);

  it('public security rejects a declarative-shadow template hiding an unreceipted runtime script', async () => {
    const currentHtml = await readFile('index.html', 'utf8');
    const result = await runStandaloneSecurityWithFiles({
      'index.html': currentHtml.replace(
        '<div id="root"></div>',
        `<div id="root">
      <template shadowrootmode="open">
        <script type="module" src="/escape.js"></script>
      </template>
    </div>`,
      ),
      'public/escape.js': `globalThis['loc' + 'ation']['ass' + 'ign']('/escape');\n`,
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/template|declarative shadow|javascript|asset inventory|receipt/i);
  }, 90_000);

  it('public security rejects an unreferenced executable asset without a build receipt', async () => {
    const result = await runStandaloneSecurityWithFiles({
      'public/unreceipted.js': `export const apparentlySafe = 'copied without a module receipt';\n`,
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/javascript|asset inventory|receipt|unexpected/i);
  }, 90_000);

  it.each([
    ['CSP meta placed in body', (html: string, csp: string) => html
      .replace(csp, '')
      .replace('<body>', `<body>\n    ${csp}`)],
    ['CSP-looking text hidden in raw style content', (html: string, csp: string) => html
      .replace(csp, '')
      .replace('</head>', `    <style>${csp}</style>\n  </head>`)],
  ])('public security rejects %s', async (_, transform) => {
    const currentHtml = await readFile('index.html', 'utf8');
    const csp = currentHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/u)?.[0];
    expect(csp).toBeDefined();
    const result = await runStandaloneSecurityWithFiles({
      'index.html': transform(currentHtml, csp ?? ''),
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/CSP|Content-Security-Policy|head/i);
  }, 90_000);

  it('public security rejects forged arguments to the canonical CapabilityDefinition contract', async () => {
    const capabilities = await readFile('src/sandbox/capabilities.ts', 'utf8');
    const result = await runStandaloneSecurityWithFiles({
      'src/sandbox/capabilities.ts': `${capabilities}\nexport function forgedCapabilityInvocation(
  definition: CapabilityDefinition,
  hostCallback: () => void,
): SandboxWorld {
  return definition.reduce(hostCallback as unknown as SandboxWorld, {});
}\n`,
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  }, 90_000);

  it('receipts every legitimate TypeScript HTML runtime entry', async () => {
    const result = await runStandaloneSecurityWithFiles(
      { 'src/secondary.ts': `export const secondary = 'safe';\n` },
      '',
      '<script type="module" src="/src/secondary.ts"></script>',
    );

    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/entries=src\/main\.tsx,src\/secondary\.ts/i);
  }, 90_000);
});

describe('Task 9 facade and mutation paired controls', () => {
  it.each(facadeLeakForms)('rejects facade leak form: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_(?:ESCAPE|CAST)|capability escape/i);
  });

  it.each(facadeSafeForms)('accepts safe facade form: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).toBe(0);
  });

  it.each(mutationKeyHostiles)('rejects mutation key hostile: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/PROTOTYPE_WRITE|UNKNOWN_PROTOTYPE_KEY|UNPROVEN_ASSIGN_SOURCE/i);
  });

  it.each(mutationKeySafes)('accepts mutation key safe control: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });
});

describe('Task 9 bounded totality and summary identity controls', () => {
  it.each([
    ['Navigator.sendBeacon', `export {}; declare const navigator: Navigator; navigator.sendBeacon('/escape', 'payload');`, 'HOST_NETWORK'],
    ['History.pushState', `export {}; declare const history: History; history.pushState({}, '', '/escape');`, 'HOST_NAVIGATION'],
    ['Location.assign', `export {}; declare const location: Location; location.assign('/escape');`, 'HOST_NAVIGATION'],
    ['Document.write', `export {}; declare const document: Document; document.write('<main>escape</main>');`, 'HOST_UNSAFE_DOM_WRITE'],
  ])('classifies emitless typed host effect for %s', async (_, source, effect) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(effect);
  });

  it.each([
    ['client.fetch object result', `export function read(client: { fetch(): object }): object { return client.fetch(); }`],
    ['window.focus object result', `export function activate(window: { focus(): object }): object { return window.focus(); }`],
    ['document.getElementById object result', `export function lookup(document: { getElementById(id: string): object }): object { return document.getElementById('root'); }`],
  ])('rejects receiver-branded contract with aggregate return: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['client.fetch primitive result', `export function read(client: { fetch(): string }): string { return client.fetch(); }`],
    ['window.focus void result', `export function activate(window: { focus(): void }): void { window.focus(); }`],
    ['document.getElementById primitive result', `export function lookup(document: { getElementById(id: string): string }): string { return document.getElementById('root'); }`],
  ])('accepts receiver-branded contract with scalar or void return: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['client alias with callback argument', `export function run(plugin: { fetch(callback: () => void): string }, hostCallback: () => void): string { const client = plugin; return client.fetch(hostCallback); }`],
    ['direct client with callback argument', `export function run(client: { fetch(callback: () => void): string }, hostCallback: () => void): string { return client.fetch(hostCallback); }`],
    ['window alias with callback argument', `export function run(plugin: { focus(callback: () => void): void }, hostCallback: () => void): void { const window = plugin; window.focus(hostCallback); }`],
    ['document alias', `export function lookup(plugin: { getElementById(id: string): string }): string { const document = plugin; return document.getElementById('root'); }`],
    ['client contract with an extra capability field', `export function read(client: { fetch(): string; raw: HTMLElement }): string { return client.fetch(); }`],
  ])('rejects syntax-only receiver brand laundering through %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['Reflect alias', `export function leak(plugin: { get(target: { raw: object }, key: 'raw'): object }): object { const Reflect = plugin; return Reflect.get({ raw: {} }, 'raw'); }`],
    ['Object alias', `export function leak(plugin: { assign<T extends object>(target: T, source: Partial<T>): T }): object { const Object = plugin; return Object.assign({ raw: {} }, { raw: {} }); }`],
  ])('rejects syntax-only standard namespace authority through %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('accepts an exact direct Reflect.get parameter contract', async () => {
    const result = await runGate(`export function read(Reflect: { get(target: { raw: string }, key: 'raw'): string }): string { return Reflect.get({ raw: 'safe' }, 'raw'); }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['wide Reflect.get object contract', `export function leak(Reflect: { get(target: { raw: object }, key: 'raw'): object }): object { return Reflect.get({ raw: {} }, 'raw'); }`],
    ['wide Object.assign object contract', `export function leak(Object: { assign(target: { raw: object }, source: { raw: object }): object }): object { return Object.assign({ raw: {} }, { raw: {} }); }`],
    ['non-exact client.fetch return contract', `export function read(client: { fetch(): number }): number { return client.fetch(); }`],
    ['non-exact window.focus return contract', `export function activate(window: { focus(): string }): string { return window.focus(); }`],
    ['non-exact document.getElementById return contract', `export function lookup(document: { getElementById(id: string): number }): number { return document.getElementById('root'); }`],
    ['client.fetch callable object with a host field', `type FetchWithHost = { (): string; raw: HTMLElement }; export function read(client: { fetch: FetchWithHost }): string { return client.fetch(); }`],
    ['Reflect.get callable object with a host field', `type GetWithHost = { (target: { raw: string }, key: 'raw'): string; raw: HTMLElement }; export function read(Reflect: { get: GetWithHost }): string { return Reflect.get({ raw: 'safe' }, 'raw'); }`],
    ['Object.assign callable object with a host field', `type AssignWithHost = { <T extends object>(target: T, source: Partial<T>): T; raw: HTMLElement }; export function read(Object: { assign: AssignWithHost }): string { return Object.assign({ raw: 'first' }, { raw: 'second' }).raw; }`],
  ])('rejects broadened same-named receiver contract: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['same-named parameter contract', `interface CapabilityDefinition { reduce(callback: () => void): object; }
export function invokeThroughCapabilityDefinition(
  definition: CapabilityDefinition,
  hostCallback: () => void,
): object { return definition.reduce(hostCallback); }`],
    ['identity laundering of a canonical-shaped contract', `type SandboxWorld = Readonly<Record<string, string>>;
interface CapabilityDefinition {
  readonly effect: string;
  readonly argumentsSchema: object;
  readonly deriveResource: (args: Readonly<Record<string, string>>) => string;
  readonly reduce: (world: SandboxWorld, args: Readonly<Record<string, string>>) => SandboxWorld;
  readonly facts: (world: SandboxWorld) => Readonly<Record<string, string>>;
}
function identityCapability(definition: CapabilityDefinition): CapabilityDefinition { return definition; }
export function invokeLaunderedCapability(
  definition: CapabilityDefinition,
  world: SandboxWorld,
  args: Readonly<Record<string, string>>,
): SandboxWorld { const local = identityCapability(definition); return local.reduce(world, args); }`],
  ])('rejects CapabilityDefinition %s', async (_, source) => {
    const result = await runGate(source, 'src/sandbox/capabilities.ts');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('invalidates wrapper summaries when a transitive captured dependency widens', async () => {
    const result = await runGate(`
      let state: object = {};
      function source(): object { return state; }
      function wrapper(): object { return source(); }
      const before = wrapper();
      state = document.getElementById('root')!;
      export const leak: object = wrapper();
      void before;
    `, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it('fails closed without graph growth for a recursive aggregate return', async () => {
    const result = await runGate(`export function expand(items: object[]): object {
  const next = [...items, { safe: true }];
  return items.length > 1 ? next : expand(next);
}`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|Unknown/i);
  }, 10_000);

  it('fails closed without graph growth for recursive dynamic array spread', async () => {
    const result = await runGate(`export function recur(items: object[]): object {
  const nested = [...items, [...items]];
  return items.length > 2 ? nested : recur(nested);
}`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|Unknown/i);
  }, 10_000);

  it('does not hide a forbidden effect in a void local helper', async () => {
    const result = await runGate(`function navigate(value: string): void {
  window.location.assign(value);
}
navigate('/escape');
export {};`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_NAVIGATION|navigation/i);
  });

  it('does not hide an owned escape routed through a void helper', async () => {
    const result = await runGate(`declare const external: (value: { label: string }) => void;
function relay(value: { label: string }): void { external(value); }
const local = { label: 'owned' };
relay(local);
local.label = 'after boundary';
export {};`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown|escape/i);
  });

  it('keeps distinct bound targets and argument vectors separate', async () => {
    const result = await runGate(`function row(value: string) { return { value }; }
const left = row.bind(undefined, 'left');
const right = row.bind(undefined, 'right');
export const rows = [left(), right()];`);

    expect(result.status, result.output).toBe(0);
  });
});

describe('Task 9 post-green root bypass controls', () => {
  it('rejects an unsummarized method on borrowed external data', async () => {
    const result = await runGate(`export {};
declare const plugin: { execute(): void };
plugin.execute();`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('propagates late ambient arguments through a local alias', async () => {
    const result = await runGate(`function write(node: { insertAdjacentHTML(position: 'beforeend', html: string): void }): void {
  const alias = node;
  alias.insertAdjacentHTML('beforeend', '<img src=x>');
}
write(document.getElementById('root')!);
export {};`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNSAFE_DOM_WRITE|HOST_UNKNOWN|unsafe|unknown/i);
  });

  it('propagates ordinary JSX prop origins into a known component', async () => {
    const result = await runGate(`function Writer({ node }: { node: { insertAdjacentHTML(position: 'beforeend', html: string): void } }) {
  node.insertAdjacentHTML('beforeend', '<img src=x>');
  return null;
}
const host = document.getElementById('root')!;
const view = <Writer node={host} />;
void view;
export {};`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNSAFE_DOM_WRITE|HOST_UNKNOWN|unsafe|unknown/i);
  });

  it('treats an unresolved JSX component as an escape boundary', async () => {
    const result = await runGate(`import type { ComponentType } from 'react';
declare const Plugin: ComponentType<{ value: { label: string } }>;
const owned = { label: 'safe' };
export const view = <Plugin value={owned} />;
owned.label = 'after unknown consumer';`, 'src/fixture.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown|escaped/i);
  });

  it.each([
    ['function namespace static', `export function api(): void {}
export namespace api { export const raw: object = document.getElementById('root')!; }`],
    ['class namespace static', `export class Api {}
export namespace Api { export const raw: object = document.getElementById('root')!; }`],
  ])('rejects facade merged namespace leak: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it('widens facade traversal depth exhaustion to unknown', async () => {
    const result = await runGate(`const host = document.getElementById('root')!;
export const leak: object = { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: host } } } } } } } } } } } };`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it('fails closed when the origin fixed point exceeds its iteration budget', async () => {
    const declarations = Array.from({ length: 26 }, (_, index) =>
      `let x${index}: Cell = { innerHTML: '' };`).join('\n');
    const transfers = Array.from({ length: 25 }, (_, index) =>
      `x${index} = x${index + 1};`).join(' ');
    const result = await runGate(`interface Cell { innerHTML: string }
export function poison(host: HTMLElement): void {
${declarations}
  for (let i = 0; i < 30; i += 1) { ${transfers} x25 = host; }
  x0.innerHTML = '<img src=x>';
}`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FIXED_POINT|UNPROVEN_MUTATION_RECEIVER|Ambient|Unknown/i);
  }, 10_000);

  it('rejects an unresolved callback registered with a React effect', async () => {
    const result = await runGate(`import { useEffect } from 'react';
declare const external: () => void;
export function Fixture() { useEffect(external, []); return null; }`, 'src/fixture.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('does not grant Reflect semantics to a local emitless shadow', async () => {
    const result = await runGate(`export {};
declare const Reflect: { set(target: object, key: string, value: unknown): boolean };
const target = { label: 'safe' };
Reflect.set(target, 'label', 'changed');`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('public security rejects an additional HTML runtime entry outside the analyzed subset', async () => {
    const currentHtml = await readFile('index.html', 'utf8');
    const result = await runStandaloneSecurityWithFiles({
      'index.html': currentHtml.replace('</body>', '  <script type="module" src="/src/escape.js"></script>\n  </body>'),
      'src/escape.js': `window.location.assign('/escape');\n`,
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/runtime entry|unsupported executable extension|analysis receipt|escape\.js/i);
  }, 90_000);
});

describe('Task 9 deferred-callback and facade traversal controls', () => {
  it.each([
    ['borrowed method named like a safe local contract', `export {}; declare const plugin: { fetch(): void }; plugin.fetch();`],
    ['useMemo callback', `import { useMemo } from 'react'; declare const external: () => string; export function Fixture() { return useMemo(external, []); }`],
    ['useReducer callback', `import { useReducer } from 'react'; declare const external: (state: number) => number; export function Fixture() { return useReducer(external, 0)[0]; }`],
    ['intrinsic JSX callback', `import type { MouseEventHandler } from 'react'; declare const external: MouseEventHandler<HTMLButtonElement>; export const view = <button onClick={external}>go</button>;`],
    ['Array.from callback', `export {}; declare const external: (value: number) => number; Array.from([1], external);`],
    ['String.replace callback', `export {}; declare const external: (value: string) => string; 'x'.replace('x', external);`],
    ['Zod refinement callback', `import { z } from 'zod'; declare const external: (value: string, context: z.RefinementCtx<string>) => void; z.string().superRefine(external); export {};`],
    ['host event listener callback', `export {}; declare const media: MediaQueryList; declare const external: (event: MediaQueryListEvent) => void; media.addEventListener('change', external);`],
  ])('rejects unresolved deferred callback: %s', async (_, source) => {
    const result = await runGate(source, source.includes('<button') ? 'src/fixture.tsx' : 'src/main.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['object getter', `export const api: { readonly raw: object } = { get raw() { return document.getElementById('root')!; } };`],
    ['merged namespace function', `export function api(): void {} export namespace api { export function raw(): object { return document.getElementById('root')!; } }`],
  ])('rejects facade runtime capability hidden in %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it('rejects a facade runtime callable hidden behind an object type and finite-surface compaction', async () => {
    const nested = Array.from(
      { length: 25 },
      (_, index) => index,
    ).reduceRight((value, index) => `{ n${index}: ${value} }`, '{ raw: host }');
    const result = await runGate(`const host: object = document.getElementById('root')!;
function keep(value: object): object { return value; }
const huge = ${nested};
export const leak: object = keep({ callback: (): object => huge });`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it.each([
    ['contextual void callback returning a host value', `export const leak: () => void = () => document.getElementById('root')!;`],
    ['aggregate runtime value erased to a declared primitive', `type Dynamic = ReturnType<typeof JSON.parse>; function erase(value: object): Dynamic { return value; } const value = { raw: document.getElementById('root')! }; export const leak: string = erase(value);`],
    ['same-allocation nested wrapper traversal', `interface Box { readonly next: object } function wrap(value: object): Box { return { next: value }; } const host: object = document.getElementById('root')!; export const leak: object = wrap(wrap(host));`],
  ])('rejects facade runtime/type mismatch through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });

  it('accepts resolved local callbacks across the modeled deferred APIs', async () => {
    const result = await runGate(`import { useMemo, useReducer } from 'react';
import { z } from 'zod';
function reduce(state: number): number { return state + 1; }
function refine(_value: string, _context: z.RefinementCtx<string>): void {}
export function Fixture() {
  const memo = useMemo(() => 'safe', []);
  const [state] = useReducer(reduce, 0);
  const rows = Array.from([1], (value) => value + 1);
  const label = 'x'.replace('x', (value) => value);
  z.string().superRefine(refine);
  return <button onClick={() => undefined}>{memo}{state}{rows[0]}{label}</button>;
}`, 'src/fixture.tsx');

    expect(result.status, result.output).toBe(0);
  });
});

describe('Task 9 total value-transfer and facade content controls', () => {
  it.each([
    ['tagged-template substitution', `function pass(_strings: TemplateStringsArray, value: object): object { return value; } export const leak: object = pass\`${'${document.getElementById(\'root\')!}'}\`;`],
    ['object destructuring default', `const { raw = document.getElementById('root')! }: { raw?: object } = {}; export { raw };`],
    ['array destructuring default', `const [raw = document.getElementById('root')!]: [object?] = []; export { raw };`],
    ['computed object content', `declare const key: string; export const api: Record<string, object> = { safe: {}, [key]: document.getElementById('root')! };`],
    ['computed null-prototype write content', `declare const key: string; const api = Object.create(null) as Record<string, object>; api.safe = {}; api[key] = document.getElementById('root')!; export { api };`],
    ['reduce accumulator', `const host: object = document.getElementById('root')!; export const leak: object = [1].reduce<object>((accumulator) => accumulator, host);`],
  ])('rejects facade capability transfer through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape|HOST_UNKNOWN|Unknown/i);
  });

  it('rejects an unresolved JSON.stringify replacer', async () => {
    const result = await runGate(`export {}; declare const external: (key: string, value: unknown) => unknown; const value = JSON.stringify({ x: 1 }, external); void value;`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['whole props capture', `let captured: object = {}; function Capture(props: { value: object }) { captured = props.value; return null; } const host: object = document.getElementById('root')!; const view = <Capture value={host} />; void view; export { captured };`],
    ['nested props capture', `let captured: object = {}; function Capture({ nested: { value } }: { nested: { value: object } }) { captured = value; return null; } const host: object = document.getElementById('root')!; const view = <Capture nested={{ value: host }} />; void view; export { captured };`],
    ['JSX children capture', `let captured: object = {}; function Capture({ children }: { children: object }) { captured = children; return null; } const host: object = document.getElementById('root')!; const view = <Capture>{host}</Capture>; void view; export { captured };`],
    ['destructured direct argument return', `function unwrap({ value }: { value: object }): object { return value; } const host: object = document.getElementById('root')!; export const leak: object = unwrap({ value: host });`],
    ['destructured direct argument capture', `let captured: object = {}; function capture({ value }: { value: object }): void { captured = value; } const host: object = document.getElementById('root')!; capture({ value: host }); export { captured };`],
    ['rest parameter return', `function second(...values: object[]): object { return values[1]!; } const host: object = document.getElementById('root')!; export const leak: object = second({}, host);`],
    ['spread-call return', `function second(_first: object, value: object): object { return value; } const host: object = document.getElementById('root')!; const values: [object, object] = [{}, host]; export const leak: object = second(...values);`],
    ['aliased-call capture', `let captured: object = {}; function capture(value: object): void { captured = value; } const alias = capture; const host: object = document.getElementById('root')!; alias(host); export { captured };`],
    ['meta-call capture', `let captured: object = {}; function capture(value: object): void { captured = value; } const host: object = document.getElementById('root')!; capture.call(undefined, host); export { captured };`],
  ])('rejects facade interprocedural transfer through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape|HOST_UNKNOWN|Unknown/i);
  });

  it.each([
    ['resolved component props spread', `let captured!: object; function Capture({ value }: { value: object }) { captured = value; return null; } const host: object = document.getElementById('root')!; const props = { value: host }; const view = <Capture {...props} />; void view; export { captured };`],
    ['resolved component object-rest parameter', `let captured!: object; function Capture({ ...props }: { value: object }) { captured = props.value; return null; } const host: object = document.getElementById('root')!; const view = <Capture value={host} />; void view; export { captured };`],
    ['nested resolved component', `let captured!: object; function Capture({ inner }: { inner: object }) { captured = inner; return null; } function Outer({ value }: { value: object }) { return <Capture inner={value} />; } const host: object = document.getElementById('root')!; const view = <Outer value={host} />; void view; export { captured };`],
    ['three-level resolved component chain', `let captured!: object; function Capture({ inner }: { inner: object }) { captured = inner; return null; } function Middle({ value }: { value: object }) { return <Capture inner={value} />; } function Outer({ value }: { value: object }) { return <Middle value={value} />; } const host: object = document.getElementById('root')!; const view = <Outer value={host} />; void view; export { captured };`],
  ])('rejects facade transfer through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape|HOST_UNKNOWN|Unknown/i);
  });

  it.each([
    ['safe resolved component props spread', `let captured = 'first'; function Capture({ value }: { value: string }) { captured = value; return null; } const props = { value: 'second' }; const view = <Capture {...props} />; void view; export { captured };`],
    ['safe resolved component object-rest parameter', `let captured = 'first'; function Capture({ ...props }: { value: string }) { captured = props.value; return null; } const view = <Capture value="second" />; void view; export { captured };`],
    ['safe nested resolved component', `let captured = 'first'; function Capture({ inner }: { inner: string }) { captured = inner; return null; } function Outer({ value }: { value: string }) { return <Capture inner={value} />; } const view = <Outer value="second" />; void view; export { captured };`],
  ])('accepts %s', async (_, source) => {
    const result = await runGate(source, 'src/fixture.tsx');

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['intrinsic any callback', `declare const external: any; export const view = <button onClick={external}>go</button>;`, 'src/fixture.tsx'],
    ['intrinsic spread callback', `import type { MouseEventHandler } from 'react'; declare const external: MouseEventHandler<HTMLButtonElement>; const props = { onClick: external }; export const view = <button {...props}>go</button>;`, 'src/fixture.tsx'],
    ['replace any callback', `declare const external: any; const value = 'x'.replace('x', external); void value; export {};`, 'src/main.tsx'],
    ['forwardRef callback', `import { forwardRef } from 'react'; declare const external: (props: {}, ref: unknown) => null; export const Comp = forwardRef(external);`, 'src/fixture.tsx'],
    ['unbranded parameter fetch', `export function run(plugin: { fetch(): void }): void { plugin.fetch(); }`, 'src/main.tsx'],
    ['unbranded mapped fetch', `interface Plugin { fetch(): void } declare const plugins: readonly Plugin[]; plugins.map((plugin) => plugin.fetch()); export {};`, 'src/main.tsx'],
  ])('rejects unresolved callback or unbranded contract through %s', async (_, source, path) => {
    const result = await runGate(source, path);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it('rejects a merged namespace class whose instance method returns a host capability', async () => {
    const result = await runGate(`export function api(): void {} export namespace api { export class Raw { reveal(): object { return document.getElementById('root')!; } } }`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape/i);
  });
});

describe('Task 9 callback lifecycle and host-input controls', () => {
  it.each([
    ['useState initializer', `import { useState } from 'react'; declare const external: () => number; export function Fixture() { const [value] = useState(external); return <span>{value}</span>; }`],
    ['useReducer initializer', `import { useReducer } from 'react'; function reducer(state: number, action: number) { return state + action; } declare const external: (arg: number) => number; export function Fixture() { const [value] = useReducer(reducer, 0, external); return <span>{value}</span>; }`],
    ['state updater', `import { useState } from 'react'; declare const external: (value: number) => number; export function Fixture() { const [, setValue] = useState(0); setValue(external); return null; }`],
    ['effect cleanup', `import { useEffect } from 'react'; declare const cleanup: () => void; export function Fixture() { useEffect(() => cleanup, []); return null; }`],
    ['Zod global error callback', `import { z } from 'zod'; declare const external: (issue: unknown) => string; z.config({ customError: external }); export {};`],
  ])('rejects unresolved framework callback lifecycle: %s', async (_, source) => {
    const result = await runGate(source, 'src/fixture.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|unknown/i);
  });

  it.each([
    ['host MediaQueryListEvent capture', `let leaked: object = {}; const listener = (event: MediaQueryListEvent): void => { leaked = event; }; window.matchMedia('(max-width: 899px)').addEventListener('change', listener); export { leaked };`],
    ['host Event capture', `let leaked: object = {}; const listener = (event: Event): void => { leaked = event; }; window.matchMedia('(max-width: 899px)').addEventListener('change', listener); export { leaked };`],
    ['timer callback capture', `let leaked: object = {}; const host: object = document.getElementById('root')!; window.setInterval(() => { leaked = host; }, 10); export { leaked };`],
    ['timer callback argument capture', `let leaked: object = {}; const host: object = document.getElementById('root')!; window.setInterval((value: object) => { leaked = value; }, 10, host); export { leaked };`],
    ['exported host Event', `export function leak(event: Event): object { return event; }`],
    ['catch binding', `let leaked: object = {}; try { throw document.getElementById('root')!; } catch (error) { leaked = error as object; } export { leaked };`],
    ['inherited class field', `class Base { raw: object = document.getElementById('root')!; } export class Leak extends Base {}`],
    ['inherited private state', `class Base { #raw: object = document.getElementById('root')!; reveal(): object { return this.#raw; } } export class Leak extends Base {}`],
  ])('rejects facade host authority through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape|HOST_UNKNOWN|Unknown/i);
  });

  it.each([
    ['call thisArg', `function expose(this: object): object { return this; } const host: object = document.getElementById('root')!; export const leak: object = expose.call(host);`],
    ['apply thisArg', `function expose(this: object): object { return this; } const host: object = document.getElementById('root')!; export const leak: object = expose.apply(host, []);`],
    ['bound thisArg', `function expose(this: object): object { return this; } const host: object = document.getElementById('root')!; const bound = expose.bind(host); export const leak: object = bound();`],
  ])('rejects facade authority through meta-call %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|capability escape|HOST_UNKNOWN|Unknown/i);
  });
});

describe('Task 9 review fix round 2 exact regressions', () => {
  it('rejects Reflect.set when its fourth effective receiver is borrowed', async () => {
    const result = await runGate(`export function reviewReflectSetReceiver(receiver: object): void {
  Reflect.set({}, 'marker', 'changed', receiver);
}`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_MUTATION_RECEIVER|HOST_UNKNOWN|Reflect\.set/i);
  });

  it.each([
    ['ambient fourth receiver', `const receiver = document.body; Reflect.set({}, 'marker', 'changed', receiver); export {};`],
    ['aliased borrowed fourth receiver', `export function update(receiver: object): void { const set = Reflect.set; set({}, 'marker', 'changed', receiver); }`],
    ['call borrowed fourth receiver', `export function update(receiver: object): void { Reflect.set.call(undefined, {}, 'marker', 'changed', receiver); }`],
    ['apply borrowed fourth receiver', `export function update(receiver: object): void { Reflect.set.apply(undefined, [{}, 'marker', 'changed', receiver]); }`],
    ['bound borrowed fourth receiver', `export function update(receiver: object): void { const setMarker = Reflect.set.bind(undefined, {}, 'marker', 'changed'); setMarker(receiver); }`],
    ['borrowed dispatch target', `export function update(target: object): void { Reflect.set(target, 'marker', 'changed', { marker: 'before' }); }`],
    ['accessor dispatch target', `let observed = ''; const target = { set marker(value: string) { observed = value; } }; const receiver = { marker: 'before' }; Reflect.set(target, 'marker', 'changed', receiver); export { observed, receiver };`],
    ['dynamic prototype-bearing key', `declare const key: string; const target = {}; Reflect.set(target, key, 'changed'); export { target };`],
    ['prototype key with fourth receiver', `const target = {}; const receiver = {}; Reflect.set(target, '__proto__', { polluted: true }, receiver); export { receiver };`],
    ['Proxy dispatch target', `const target = new Proxy({}, {}); const receiver = {}; Reflect.set(target, 'marker', 'changed', receiver); export { receiver };`],
    ['dynamic key plain target and null-prototype receiver', `export function update(key: string) { const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; Reflect.set(target, key, { polluted: true }, receiver); return receiver; }`],
    ['finite-or-dynamic key alternative', `export function update(key: string, choose: boolean) { const target = { marker: 'target' }; const receiver = { marker: 'before' } as Record<string, unknown>; const selected = choose ? 'marker' : key; Reflect.set(target, selected, { polluted: true }, receiver); return receiver; }`],
    ['borrowed custom prototype dispatch', `export function update(proto: object) { const target = { __proto__: proto }; const receiver = { marker: 'before' }; Reflect.set(target, 'marker', 'changed', receiver); return receiver; }`],
    ['borrowed prototype self-target direct dispatch', `export function update(proto: object) { const target = { __proto__: proto }; Reflect.set(target, 'marker', 'changed'); return target; }`],
    ['borrowed prototype self-target alias dispatch', `export function update(proto: object) { const set = Reflect.set; const target = { __proto__: proto }; set(target, 'marker', 'changed'); return target; }`],
    ['borrowed prototype self-target call dispatch', `export function update(proto: object) { const target = { __proto__: proto }; Reflect.set.call(undefined, target, 'marker', 'changed'); return target; }`],
    ['borrowed prototype self-target apply dispatch', `export function update(proto: object) { const target = { __proto__: proto }; Reflect.set.apply(undefined, [target, 'marker', 'changed']); return target; }`],
    ['borrowed prototype joined target dispatch', `export function update(left: object, right: object, choose: boolean) { const target = choose ? { __proto__: left } : { __proto__: right }; Reflect.set(target, 'marker', 'changed'); return target; }`],
    ['aliased dynamic key with null-prototype receiver', `export function update(key: string) { const set = Reflect.set; const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; set(target, key, 'changed', receiver); return receiver; }`],
    ['called dynamic key with null-prototype receiver', `export function update(key: string) { const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; Reflect.set.call(undefined, target, key, 'changed', receiver); return receiver; }`],
    ['applied dynamic key with null-prototype receiver', `export function update(key: string) { const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; Reflect.set.apply(undefined, [target, key, 'changed', receiver]); return receiver; }`],
    ['bound dynamic key with null-prototype receiver', `export function update(key: string) { const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; const setKey = Reflect.set.bind(undefined, target, key, 'changed'); setKey(receiver); return receiver; }`],
    ['reassigned formerly finite key', `export function update(key: string) { let selected = 'marker'; selected = key; const target = { marker: 'target' }; const receiver = Object.create(null) as Record<string, unknown>; Reflect.set(target, selected, 'changed', receiver); return receiver; }`],
    ['deleted initial own-data key', `export function update(proto: object) { const target = { __proto__: proto, marker: 'owned' } as { marker?: string }; delete target.marker; Reflect.set(target, 'marker', 'changed'); return target; }`],
    ['direct assignment through custom prototype', `export function update(proto: object) { const target = { __proto__: proto } as Record<string, unknown>; target.marker = 'changed'; return target; }`],
    ['Object.assign through custom prototype', `export function update(proto: object) { const target = { __proto__: proto }; Object.assign(target, { marker: 'changed' }); return target; }`],
  ])('rejects hostile Reflect.set effective-receiver path: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_MUTATION_RECEIVER|UNPROVEN_REFLECT_SET_TARGET|UNPROVEN_SET_DISPATCH|UNKNOWN_PROTOTYPE_KEY|PROTOTYPE_WRITE|HOST_UNKNOWN|HOST_DYNAMIC_CODE|Reflect\.set/i);
  });

  it.each([
    ['owned three-argument data write', `const target = { marker: 'before' }; Reflect.set(target, 'marker', 'changed'); export { target };`],
    ['intrinsic prototype new data key', `const target = {}; Reflect.set(target, 'marker', 'changed'); export { target };`],
    ['intrinsic prototype direct new data key', `const target: Record<string, string> = {}; target.marker = 'changed'; export { target };`],
    ['intrinsic prototype Object.assign new data key', `const target = {}; Object.assign(target, { marker: 'changed' }); export { target };`],
    ['owned four-argument data write', `const target = { marker: 'target' }; const receiver = { marker: 'before' }; Reflect.set(target, 'marker', 'changed', receiver); export { receiver };`],
    ['aliased owned fourth receiver', `const set = Reflect.set; const target = { marker: 'target' }; const receiver = { marker: 'before' }; set(target, 'marker', 'changed', receiver); export { receiver };`],
    ['call owned fourth receiver', `const target = { marker: 'target' }; const receiver = { marker: 'before' }; Reflect.set.call(undefined, target, 'marker', 'changed', receiver); export { receiver };`],
    ['apply owned fourth receiver', `const target = { marker: 'target' }; const receiver = { marker: 'before' }; Reflect.set.apply(undefined, [target, 'marker', 'changed', receiver]); export { receiver };`],
    ['bound owned fourth receiver', `const target = { marker: 'target' }; const receiver = { marker: 'before' }; const setMarker = Reflect.set.bind(undefined, target, 'marker', 'changed'); setMarker(receiver); export { receiver };`],
    ['finite conditional key', `const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; const key = true ? 'left' : 'right'; Reflect.set(target, key, 3, receiver); export { receiver };`],
    ['finite literal-union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; Reflect.set(target, key, 3, receiver); return receiver; }`],
    ['aliased finite literal-union key', `export function update(key: 'left' | 'right') { const set = Reflect.set; const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; set(target, key, 3, receiver); return receiver; }`],
    ['called finite literal-union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; Reflect.set.call(undefined, target, key, 3, receiver); return receiver; }`],
    ['applied finite literal-union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; Reflect.set.apply(undefined, [target, key, 3, receiver]); return receiver; }`],
    ['bound finite literal-union key', `export function update(key: 'left' | 'right') { const target = { left: 1, right: 2 }; const receiver = { left: 1, right: 2 }; const setKey = Reflect.set.bind(undefined, target, key, 3); setKey(receiver); return receiver; }`],
    ['null-prototype dynamic key', `declare const key: string; const target = Object.create(null) as Record<string, string>; const receiver = Object.create(null) as Record<string, string>; Reflect.set(target, key, 'changed', receiver); export { receiver };`],
    ['null-prototype object-literal dynamic key', `export function update(key: string) { const target = { __proto__: null } as Record<string, unknown>; const receiver = { __proto__: null } as Record<string, unknown>; Reflect.set(target, key, 'changed', receiver); return receiver; }`],
    ['custom prototype with proven own data key', `export function update(proto: object) { const target = { __proto__: proto, marker: 'target' }; const receiver = { marker: 'before' }; Reflect.set(target, 'marker', 'changed', receiver); return receiver; }`],
    ['custom prototype own key direct assignment', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' }; target.marker = 'changed'; return target; }`],
    ['custom prototype own key Object.assign', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' }; Object.assign(target, { marker: 'changed' }); return target; }`],
    ['Reflect before delete preserves pre-call own key', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; Reflect.set(target, 'marker', 'changed'); delete target.marker; return target; }`],
    ['data descriptor re-establishes a deleted own key', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; delete target.marker; Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
  ])('accepts safe Reflect.set effective-receiver path: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a deferred timer closure after its captured slot widens to a host object', async () => {
    const result = await runGate(`const reviewHost: object = document.getElementById('root')!;
let reviewSource: object = {};
let reviewLeaked: object = {};
const reviewTick = (): void => { reviewLeaked = reviewSource; };
export function reviewSchedule(): void { window.setInterval(reviewTick, 180); }
export function reviewStageHost(): void { reviewSource = reviewHost; }
export function reviewReadLeaked(): object { return reviewLeaked; }`, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|HOST_UNKNOWN|Ambient|capability escape/i);
  });

  it.each([
    ['timer alias registered before widening', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; const alias = tick; export function schedule(): void { window.setInterval(alias, 180); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['timer registered after widening in source order', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; export function stage(): void { source = host; } export function schedule(): void { window.setInterval(tick, 180); } export function read(): object { return leaked; }`],
    ['nested timer wrapper registered before widening', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; const wrapper = (): void => tick(); export function schedule(): void { window.setInterval(wrapper, 180); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['repeated timer registrations before widening', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; export function schedule(): void { window.setInterval(tick, 180); window.setInterval(tick, 180); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['listener callback registered before widening', `const media = window.matchMedia('(max-width: 899px)'); let source: object = {}; let leaked: object = {}; const update = (): void => { leaked = source; }; export function subscribe(): void { media.addEventListener('change', update); } export function stage(): void { source = media; } export function read(): object { return leaked; }`],
    ['React effect callback registered before widening', `import { useEffect } from 'react'; const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; export function useSchedule(): void { useEffect(tick, []); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['JSX callback registered before widening', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; export function Fixture() { return <button onClick={tick}>run</button>; } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
  ])('rejects stale deferred capture through %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|HOST_UNKNOWN|Ambient|capability escape/i);
  });

  it.each([
    ['timer scalar capture', `let source = 'first'; let observed = ''; const tick = (): void => { observed = source; }; export function schedule(): void { window.setInterval(tick, 180); } export function stage(): void { source = 'second'; } export function read(): string { return observed; }`],
    ['listener void callback', `const media = window.matchMedia('(max-width: 899px)'); const update = (): void => undefined; export function subscribe(): void { media.addEventListener('change', update); }`],
    ['React effect void callback', `import { useEffect } from 'react'; const tick = (): void => undefined; export function useSchedule(): void { useEffect(tick, []); }`],
  ])('accepts safe deferred control: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).toBe(0);
  });

  it('accepts mutation of a present owned value returned by a local Map', async () => {
    const result = await runGate(`const mapped = new Map<string, { label: string }>();
mapped.set('row', { label: 'one' });
const mappedRow = mapped.get('row');
if (mappedRow !== undefined) mappedRow.label = 'two';
export { mapped };`);

    expect(result.status, result.output).toBe(0);
  });

  it('accepts mutation of an owned value iterated from a local Set', async () => {
    const result = await runGate(`const setRows = new Set<{ label: string }>([{ label: 'one' }]);
for (const setRow of setRows.values()) setRow.label = 'two';
export { setRows };`);

    expect(result.status, result.output).toBe(0);
  });

  it('accepts a local class hard-private numeric compound write', async () => {
    const result = await runGate(`class Counter {
  #value = 0;
  increment(): void { this.#value += 1; }
  read(): number { return this.#value; }
}
const counter = new Counter();
counter.increment();
export { counter };`);

    expect(result.status, result.output).toBe(0);
  });
});

describe('Task 9 round 2 operation-prestate and semantic deferred roots', () => {
  it.each([
    ['delete before direct set', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; delete target.marker; target.marker = 'changed'; return target; }`],
    ['delete before Object.assign', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; delete target.marker; Object.assign(target, { marker: 'changed' }); return target; }`],
    ['delete before Reflect.set', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; delete target.marker; Reflect.set(target, 'marker', 'changed'); return target; }`],
    ['accessor before direct set', `export function update() { const target = { get marker() { return 'before'; }, set marker(value: string) { void value; } }; target.marker = 'changed'; return target; }`],
    ['accessor redefine before Object.assign', `export function update() { const target = { marker: 'before' }; Object.defineProperty(target, 'marker', { set(value: string) { void value; } }); Object.assign(target, { marker: 'changed' }); return target; }`],
    ['unsafe set before later data define', `export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; Reflect.set(target, 'marker', 'changed'); Object.defineProperty(target, 'marker', { value: 'defined' }); return target; }`],
  ])('rejects operation-prestate hostile: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|ACCESSOR_DESCRIPTOR|security/i);
  });

  it.each([
    ['branch-only define then direct set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; if (choose) Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
    ['branch-only define then Object.assign', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; if (choose) Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); Object.assign(target, { marker: 'changed' }); return target; }`],
    ['branch-only define then Reflect.set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; if (choose) Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); Reflect.set(target, 'marker', 'changed'); return target; }`],
  ])('rejects branch-only descriptor establishment: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it.each([
    ['try-skipped define then direct set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } catch {} target.marker = 'changed'; return target; }`],
    ['try-skipped define then Object.assign', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } catch {} Object.assign(target, { marker: 'changed' }); return target; }`],
    ['try-skipped define then Reflect.set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } catch {} Reflect.set(target, 'marker', 'changed'); return target; }`],
  ])('rejects try-skipped descriptor establishment: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it('accepts a first-statement unconditional try data definition', async () => {
    const result = await runGate(`export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; try { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } catch {} target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['nested try block then direct set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } } catch {} target.marker = 'changed'; return target; }`],
    ['nested try block then Object.assign', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } } catch {} Object.assign(target, { marker: 'changed' }); return target; }`],
    ['nested try block then Reflect.set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; try { { if (choose) throw new Error('skip'); Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } } catch {} Reflect.set(target, 'marker', 'changed'); return target; }`],
    ['label break then direct set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; definition: { if (choose) break definition; Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } target.marker = 'changed'; return target; }`],
    ['label break then Object.assign', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; definition: { if (choose) break definition; Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } Object.assign(target, { marker: 'changed' }); return target; }`],
    ['label break then Reflect.set', `export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; definition: { if (choose) break definition; Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } Reflect.set(target, 'marker', 'changed'); return target; }`],
  ])('rejects abrupt descriptor-establishment bypass: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it.each([
    ['logical AND assignment', `export function update(proto: object, gate: unknown) { const target = { __proto__: proto } as { marker?: string }; gate &&= Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
    ['logical OR assignment', `export function update(proto: object, gate: unknown) { const target = { __proto__: proto } as { marker?: string }; gate ||= Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
    ['nullish assignment', `export function update(proto: object, gate: unknown) { const target = { __proto__: proto } as { marker?: string }; gate ??= Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
  ])('rejects logical-assignment descriptor bypass: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_SET_DISPATCH|security/i);
  });

  it.each([
    ['caught Object.defineProperty failure', `export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; Object.freeze(target); try { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } catch {} target.marker = 'changed'; return target; }`],
    ['false Reflect.defineProperty result', `export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; Object.freeze(target); Reflect.defineProperty(target, 'marker', { value: 'defined', writable: true }); target.marker = 'changed'; return target; }`],
  ])('rejects failed descriptor establishment after freeze: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_SET_DISPATCH|security/i);
  });

  it('rejects branch-only Object.defineProperties establishment', async () => {
    const result = await runGate(`export function update(proto: object, choose: boolean) { const target = { __proto__: proto } as { marker?: string }; if (choose) Object.defineProperties(target, { marker: { value: 'defined', writable: true } }); target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_SET_DISPATCH|security/i);
  });

  it.each([
    ['assign establish first', `const target = { __proto__: { set marker(value: string) { void value; } } } as { marker?: string }; export function establish(): void { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } export function mutate(): void { Object.assign(target, { marker: 'changed' }); }`],
    ['assign mutate first', `const target = { __proto__: { set marker(value: string) { void value; } } } as { marker?: string }; export function mutate(): void { Object.assign(target, { marker: 'changed' }); } export function establish(): void { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); }`],
    ['Reflect establish first', `const target = { __proto__: { set marker(value: string) { void value; } } } as { marker?: string }; export function establish(): void { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); } export function mutate(): void { Reflect.set(target, 'marker', 'changed'); }`],
    ['Reflect mutate first', `const target = { __proto__: { set marker(value: string) { void value; } } } as { marker?: string }; export function mutate(): void { Reflect.set(target, 'marker', 'changed'); } export function establish(): void { Object.defineProperty(target, 'marker', { value: 'defined', writable: true }); }`],
  ])('rejects public action order-dependent dispatch: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it.each([
    ['direct', `target.marker = 'changed';`],
    ['compound', `target.marker += 'changed';`],
    ['update', `target.marker++;`],
    ['Object.assign', `Object.assign(target, { marker: 'changed' });`],
    ['Reflect.set', `Reflect.set(target, 'marker', 'changed');`],
  ])('rejects null-prototype accessor through %s', async (_, operation) => {
    const result = await runGate(`const target = { __proto__: null, get marker(): any { return 'before'; }, set marker(value: any) { void value; } }; ${operation} export { target };`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it.each([
    ['safe direct before later delete', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; target.marker = 'changed'; delete target.marker; return target; }`],
    ['safe assign before later delete', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; Object.assign(target, { marker: 'changed' }); delete target.marker; return target; }`],
    ['safe Reflect before later delete', `export function update(proto: object) { const target = { __proto__: proto, marker: 'before' } as { marker?: string }; Reflect.set(target, 'marker', 'changed'); delete target.marker; return target; }`],
  ])('accepts operation-prestate safe control: %s', async (_, source) => {
    const result = await runGate(source);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a computed-write key domain with an unmodeled unique-symbol alternative', async () => {
    const result = await runGate(`const token = Symbol('token'); type Key = 'marker' | typeof token; export function update(proto: object, key: Key) { const target = { __proto__: proto, marker: 'before' } as { marker: string; [token]?: string }; target[key] = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNKNOWN_PROTOTYPE_KEY|UNPROVEN_SET_DISPATCH|security/i);
  });

  it('rejects a computed-write key domain with a broad symbol alternative', async () => {
    const result = await runGate(`export function update(proto: object, key: 'marker' | symbol) { const target = { __proto__: proto, marker: 'before' } as { marker: string; [key: symbol]: string }; target[key] = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNKNOWN_PROTOTYPE_KEY|UNPROVEN_SET_DISPATCH|security/i);
  });

  it('accepts a complete finite computed-write key domain with own data keys', async () => {
    const result = await runGate(`export function update(proto: object, key: 'left' | 'right') { const target = { __proto__: proto, left: 'before', right: 'before' }; target[key] = 'changed'; return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects an incomplete Object.assign computed source-key domain', async () => {
    const result = await runGate(`export function update(proto: object, key: 'marker' | symbol) { const target = { __proto__: proto, marker: 'before' } as Record<PropertyKey, string>; Object.assign(target, { [key]: 'changed' }); return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_ASSIGN_SOURCE|UNPROVEN_SET_DISPATCH|UNKNOWN_PROTOTYPE_KEY|security/i);
  });

  it('accepts a complete Object.assign finite source-key domain with own data keys', async () => {
    const result = await runGate(`export function update(proto: object, key: 'left' | 'right') { const target = { __proto__: proto, left: 'before', right: 'before' }; Object.assign(target, { [key]: 'changed' }); return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects an unguarded conditional Map.get absence before mutation', async () => {
    const result = await runGate(`export function update(flag: boolean) { const rows = new Map<string, { label: string }>(); const row = (flag ? rows.get('missing') : { label: 'safe' })!; row.label = 'changed'; return row; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_MUTATION_RECEIVER|MaybeAbsent|security/i);
  });

  it('accepts a guarded conditional Map.get value before mutation', async () => {
    const result = await runGate(`export function update(flag: boolean) { const rows = new Map<string, { label: string }>(); const row = flag ? rows.get('missing') : { label: 'safe' }; if (row !== undefined) row.label = 'changed'; return row; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects strict-null-only narrowing of a possibly undefined Map.get value', async () => {
    const result = await runGate(`export function update() { const rows = new Map<string, { label: string }>([['present', { label: 'safe' }]]); const row = rows.get('missing'); if (row !== null) row!.label = 'changed'; return row; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_MUTATION_RECEIVER|MaybeAbsent|security/i);
  });

  it('accepts undefined narrowing of a Map.get value', async () => {
    const result = await runGate(`export function update() { const rows = new Map<string, { label: string }>([['present', { label: 'safe' }]]); const row = rows.get('missing'); if (row !== undefined) row.label = 'changed'; return row; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a computed descriptor setter method before mutation', async () => {
    const result = await runGate(`export function update(setter: (value: string) => void) { const target = {} as { marker: string }; Object.defineProperty(target, 'marker', { ['set'](value: string) { setter(value); } }); target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/ACCESSOR_DESCRIPTOR|UNPROVEN_SET_DISPATCH|HOST_UNKNOWN|security/i);
  });

  it('rejects an effect-free computed descriptor setter method', async () => {
    const result = await runGate(`export function update() { const target = {} as { marker: string }; Object.defineProperty(target, 'marker', { ['set'](value: string) { void value; } }); target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/ACCESSOR_DESCRIPTOR|UNPROVEN_SET_DISPATCH|security/i);
  });

  it('accepts an explicit data descriptor before mutation', async () => {
    const result = await runGate(`export function update() { const target = {} as { marker: string }; Object.defineProperty(target, 'marker', { value: 'before', writable: true }); target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a throwing descriptor initializer in a first try statement', async () => {
    const result = await runGate(`function descriptorValue(): string { throw new Error('skip'); } export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; try { Object.defineProperty(target, 'marker', { value: descriptorValue(), writable: true }); } catch {} target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_SET_DISPATCH|security/i);
  });

  it('rejects an emitless descriptor initializer in a first try statement', async () => {
    const result = await runGate(`declare const later: string; export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; try { Object.defineProperty(target, 'marker', { value: later, writable: true }); } catch {} target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_SET_DISPATCH|security/i);
  });

  it('accepts an initialized descriptor value in a first try statement', async () => {
    const result = await runGate(`const earlier = 'defined'; export function update(proto: object) { const target = { __proto__: proto } as { marker?: string }; try { Object.defineProperty(target, 'marker', { value: earlier, writable: true }); } catch {} target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['direct assignment', `target.marker = 'changed';`],
    ['Object.assign', `Object.assign(target, { marker: 'changed' });`],
    ['Reflect.set', `Reflect.set(target, 'marker', 'changed');`],
  ])('rejects %s through a non-writable data descriptor', async (_, operation) => {
    const result = await runGate(`export function update() { const target = {} as { marker: string }; Object.defineProperty(target, 'marker', { value: 'before' }); ${operation} return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it.each([
    ['direct assignment', `target.marker = 'changed';`],
    ['Object.assign', `Object.assign(target, { marker: 'changed' });`],
    ['Reflect.set', `Reflect.set(target, 'marker', 'changed');`],
  ])('rejects %s through a frozen receiver', async (_, operation) => {
    const result = await runGate(`export function update() { const target = Object.freeze({ marker: 'before' }); ${operation} return target; }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it('accepts mutation of a fresh spread copied from frozen data', async () => {
    const result = await runGate(`export function update() { const frozen = Object.freeze({ marker: 'before' }); const target = { ...frozen }; target.marker = 'changed'; return target; }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a helper-defined host callback re-exported through the browser facade', async () => {
    const result = await runGateFiles({
      'src/platform/deferred-helper.ts': `export interface SafeBox { readonly id: string }
let source: SafeBox = { id: 'safe' }; let leaked: SafeBox = { id: 'safe' };
export function tick(): void { leaked = source; }
export function stage(next: SafeBox): void { source = next; }
export function read(): SafeBox { return leaked; }`,
      'src/platform/browser-capabilities.tsx': `import { read as readInternal, stage as stageInternal, tick, type SafeBox } from './deferred-helper';
const hostBox: SafeBox = document.getElementById('root')!;
export function schedule(): void { window.setInterval(tick, 180); }
export const stage = stageInternal.bind(undefined, hostBox);
export const read = readInternal;`,
    });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|HOST_UNKNOWN|capability escape/i);
  });

  it('accepts a capability-free helper callback re-exported through the browser facade', async () => {
    const result = await runGateFiles({
      'src/platform/deferred-safe-helper.ts': `export interface SafeBox { readonly id: string }
let source: SafeBox = { id: 'safe' }; let observed = 'safe';
export function tick(): void { observed = source.id; }
export function stage(next: SafeBox): void { source = next; }
export function read(): string { return observed; }`,
      'src/platform/browser-capabilities.tsx': `import { read as readInternal, stage as stageInternal, tick } from './deferred-safe-helper';
export function schedule(): void { window.setInterval(tick, 180); }
export const stage = stageInternal.bind(undefined, { id: 'still-safe' });
export const read = readInternal;`,
    });

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['direct member JSX callback', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const handlers = { tick: (): void => { leaked = source; } }; export function Fixture() { return <button onClick={handlers.tick}>run</button>; } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['spread member JSX callback', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const handlers = { tick: (): void => { leaked = source; } }; const props = { onClick: handlers.tick }; export function Fixture() { return <button {...props}>run</button>; } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['useCallback JSX callback', `import { useCallback } from 'react'; const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; export function Fixture() { const tick = useCallback((): void => { leaked = source; }, []); return <button onClick={tick}>run</button>; } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['timer member callback', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const handlers = { tick: (): void => { leaked = source; } }; export function schedule(): void { window.setInterval(handlers.tick, 180); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['timer bound callback', `const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const tick = (): void => { leaked = source; }; const bound = tick.bind(undefined); export function schedule(): void { window.setInterval(bound, 180); } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['React effect cleanup callback', `import { useEffect } from 'react'; const host: object = document.getElementById('root')!; let source: object = {}; let leaked: object = {}; const cleanup = (): void => { leaked = source; }; const effect = (): (() => void) => cleanup; export function Fixture() { useEffect(effect, []); return null; } export function stage(): void { source = host; } export function read(): object { return leaked; }`],
    ['timer argument retains mutable cell', `const host: object = document.getElementById('root')!; const cell: { value: object } = { value: {} }; let leaked: object = {}; function tick(current: { value: object }): void { leaked = current.value; } export function schedule(): void { window.setInterval(tick, 180, cell); } export function stage(): void { cell.value = host; } export function read(): object { return leaked; }`],
    ['bound-this callback retains mutable cell', `const host: object = document.getElementById('root')!; const cell: { value: object } = { value: {} }; let leaked: object = {}; function tick(this: { value: object }): void { leaked = this.value; } const bound = tick.bind(cell); export function schedule(): void { window.setInterval(bound, 180); } export function stage(): void { cell.value = host; } export function read(): object { return leaked; }`],
    ['nested wrappers observe in-place mutation', `const host: object = document.getElementById('root')!; const cell: { source: object } = { source: {} }; let leaked: object = {}; const tick = (): void => { leaked = cell.source; }; const middle = (): void => tick(); const outer = (): void => middle(); export function schedule(): void { window.setInterval(outer, 180); } export function stage(): void { cell.source = host; } export function read(): object { return leaked; }`],
    ['mutually recursive wrappers fail closed after staged mutation', `const host: object = document.getElementById('root')!; const cell: { source: object } = { source: {} }; let leaked: object = {}; let recurse = false; const tick = (): void => { leaked = cell.source; }; function first(): void { if (recurse) { recurse = false; second(); } else tick(); } function second(): void { first(); } export function schedule(): void { window.setInterval(first, 180); } export function stage(): void { cell.source = host; recurse = true; } export function read(): object { return leaked; }`],
  ])('rejects semantic deferred hostile: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/FACADE_CAPABILITY_ESCAPE|HOST_UNKNOWN|Ambient|capability escape/i);
  });

  it.each([
    ['timer argument scalar cell', `const cell = { value: 'safe' }; let leaked = ''; function tick(current: { value: string }): void { leaked = current.value; } export function schedule(): void { window.setInterval(tick, 180, cell); } export function stage(): void { cell.value = 'still-safe'; } export function read(): string { return leaked; }`],
    ['timer literal scalar argument', `function tick(value: string): void { void value; } export function schedule(): void { window.setInterval(tick, 180, 'safe'); }`],
    ['timer fresh local argument', `function tick(value: { label: string }): void { void value.label; } export function schedule(): void { window.setInterval(tick, 180, { label: 'safe' }); }`],
    ['spread JSX void callback', `const props = { onClick: (): void => undefined }; export function Fixture(): null { void <button {...props}>run</button>; return null; }`],
    ['effect cleanup void callback', `import { useEffect } from 'react'; const cleanup = (): void => undefined; export function Fixture() { useEffect(() => cleanup, []); return null; }`],
  ])('accepts semantic deferred safe control: %s', async (_, source) => {
    const result = await runGate(source, 'src/platform/browser-capabilities.tsx');

    expect(result.status, result.output).toBe(0);
  });
});

describe('Task 9 review fix round 3 spread and argument canonicalization', () => {
  it.each([
    ['Reflect.set direct', `Reflect.set(target, 'marker', 'changed');`],
    ['Reflect.set alias', `const set = Reflect.set; set(target, 'marker', 'changed');`],
    ['Reflect.set call', `Reflect.set.call(Reflect, target, 'marker', 'changed');`],
    ['Reflect.set apply', `Reflect.set.apply(Reflect, [target, 'marker', 'changed']);`],
    ['Reflect.set bind', `const set = Reflect.set.bind(Reflect, target); set('marker', 'changed');`],
    ['same-module helper', `function setMarker(value: object): void { Reflect.set(value, 'marker', 'changed'); } setMarker(target);`],
    ['direct assignment', `target.marker = 'changed';`],
    ['Object.assign', `Object.assign(target, { marker: 'changed' });`],
  ])('rejects conditional-spread may-presence through %s', async (_, operation) => {
    const result = await runGate(`export function update(proto: object, choose: boolean): void {
      const source = choose ? { marker: 'present' } : {};
      const target = { __proto__: proto, ...source };
      ${operation}
    }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET)|security/i);
  });

  it('accepts a spread key definitely present on every source alternative', async () => {
    const result = await runGate(`export function update(proto: object, choose: boolean): void {
      const source = choose ? { marker: 'left' } : { marker: 'right' };
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).toBe(0);
  });

  it('rejects a spread key made non-enumerable by a data descriptor', async () => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      Object.defineProperty(source, 'marker', {
        value: 'hidden', writable: true, enumerable: false,
      });
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_REFLECT_SET_TARGET|security/i);
  });

  it('accepts an existing enumerable key when a descriptor omits enumerable', async () => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      Object.defineProperty(source, 'marker', { value: 'updated', writable: true });
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['Object.defineProperty direct', `Object.defineProperty(source, 'marker', descriptor);`],
    ['Object.defineProperty alias', `const define = Object.defineProperty; define(source, 'marker', descriptor);`],
    ['Object.defineProperty call', `Object.defineProperty.call(Object, source, 'marker', descriptor);`],
    ['Object.defineProperty apply', `Object.defineProperty.apply(Object, [source, 'marker', descriptor]);`],
    ['Object.defineProperty bind', `const define = Object.defineProperty.bind(Object, source); define('marker', descriptor);`],
    ['Object.defineProperty helper', `function hide(value: object): void { Object.defineProperty(value, 'marker', descriptor); } hide(source);`],
    ['Reflect.defineProperty', `Reflect.defineProperty(source, 'marker', descriptor);`],
    ['Object.defineProperties', `Object.defineProperties(source, { marker: descriptor });`],
  ])('rejects non-enumerable spread provenance through %s', async (_, operation) => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      const descriptor = { value: 'hidden', writable: true, enumerable: false };
      ${operation}
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/UNPROVEN_REFLECT_SET_TARGET|security/i);
  });

  it.each([
    ['conditional enumerability', `Object.defineProperty(source, 'marker', {
      value: 'hidden', writable: true, enumerable: choose,
    });`],
    ['write after non-enumerable definition', `Object.defineProperty(source, 'marker', {
      value: 'hidden', writable: true, enumerable: false,
    }); source.marker = 'updated';`],
  ])('rejects possible non-enumerability after %s', async (_, operation) => {
    const result = await runGate(`export function update(
      proto: object, choose: boolean,
    ): void {
      const source = { marker: 'present' };
      ${operation}
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).not.toBe(0);
  });

  it.each([
    ['direct', `Object.defineProperty(source, 'marker', {
      value: 'visible', writable: true, enumerable: true,
    });`],
    ['alias', `const define = Object.defineProperty; define(source, 'marker', {
      value: 'visible', writable: true, enumerable: true,
    });`],
    ['Reflect.defineProperty', `Reflect.defineProperty(source, 'marker', {
      value: 'visible', writable: true, enumerable: true,
    });`],
    ['Object.defineProperties', `Object.defineProperties(source, { marker: {
      value: 'visible', writable: true, enumerable: true,
    } });`],
  ])('accepts definitely enumerable descriptor spread through %s', async (_, operation) => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      ${operation}
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['call', `Object.defineProperty.call(Object, source, 'marker', {
      value: 'visible', writable: true, enumerable: true,
    });`],
    ['apply', `Object.defineProperty.apply(Object, [source, 'marker', {
      value: 'visible', writable: true, enumerable: true,
    }]);`],
    ['bind', `const define = Object.defineProperty.bind(Object, source);
    define('marker', { value: 'visible', writable: true, enumerable: true });`],
    ['helper', `function show(value: object): void {
      Object.defineProperty(value, 'marker', {
        value: 'visible', writable: true, enumerable: true,
      });
    }
    show(source);`],
  ])('accepts normalized definitely-enumerable descriptor spread through %s', async (_, operation) => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      ${operation}
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['call', `Object.defineProperty.call(Object, source, 'marker', {
      value: 'visible', writable: true,
    });`],
    ['apply', `Object.defineProperty.apply(Object, [source, 'marker', {
      value: 'visible', writable: true,
    }]);`],
    ['bind', `const define = Object.defineProperty.bind(Object, source);
    define('marker', { value: 'visible', writable: true });`],
    ['helper', `function show(value: object): void {
      Object.defineProperty(value, 'marker', { value: 'visible', writable: true });
    }
    show(source);`],
  ])('accepts normalized omitted-enumerability descriptor spread through %s', async (_, operation) => {
    const result = await runGate(`export function update(proto: object): void {
      const source = { marker: 'present' };
      ${operation}
      const target = { __proto__: proto, ...source };
      Reflect.set(target, 'marker', 'changed');
    }`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['apply', `Reflect.set.apply(undefined, args);`],
    ['direct spread', `Reflect.set(...args);`],
    ['call spread', `Reflect.set.call(undefined, ...args);`],
    ['bind spread', `Reflect.set.bind(undefined, ...args)();`],
  ])('rejects a sparse Reflect.set argument container through %s', async (_, invocation) => {
    const result = await runGate(`export function update(receiver: object): void {
      const target = {};
      const args = [target, , 'changed', receiver] as unknown as Parameters<typeof Reflect.set>;
      ${invocation}
    }`);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/HOST_UNKNOWN|UNPROVEN_(?:SET_DISPATCH|REFLECT_SET_TARGET|MUTATION_RECEIVER)|security/i);
  });

  it('accepts a dense four-argument Reflect.set container with an owned receiver', async () => {
    const result = await runGate(`const target = {};
      const receiver = {};
      const args = [target, 'marker', 'changed', receiver] as Parameters<typeof Reflect.set>;
      Reflect.set.apply(undefined, args);
      export { receiver };`);

    expect(result.status, result.output).toBe(0);
  });

  it.each([
    ['direct', `Object.assign(target, { marker: 'changed' });`],
    ['alias', `const assign = Object.assign; assign(target, { marker: 'changed' });`],
    ['bind', `const assign = Object.assign.bind(Object, target); assign({ marker: 'changed' });`],
    ['call', `Object.assign.call(Object, target, { marker: 'changed' });`],
    ['apply', `Object.assign.apply(Object, [target, { marker: 'changed' }]);`],
    ['helper', `function update(source: { marker: string }): void { Object.assign(target, source); } update({ marker: 'changed' });`],
  ])('accepts canonical Object.assign source records through %s', async (_, invocation) => {
    const result = await runGate(`const target = { marker: 'before' };
      ${invocation}
      export { target };`);

    expect(result.status, result.output).toBe(0);
  });
});

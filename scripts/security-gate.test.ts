import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

async function runGate(source: string, sourcePath = 'src/fixture.tsx') {
  const root = await mkdtemp(join(tmpdir(), 'mandate-security-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, dirname(sourcePath)), { recursive: true });
  await cp('dist', join(root, 'dist'), { recursive: true });
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, sourcePath), source);
  await cp('tsconfig.app.json', join(root, 'tsconfig.app.json'));
  await cp('scripts/security-gate.mjs', join(root, 'scripts', 'security-gate.mjs'));
  await cp('scripts/security-assignment-analysis.mjs', join(root, 'scripts', 'security-assignment-analysis.mjs'));
  await cp('scripts/security-built-policy.mjs', join(root, 'scripts', 'security-built-policy.mjs'));
  await cp('scripts/security-source-policy.mjs', join(root, 'scripts', 'security-source-policy.mjs'));
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
  }, 30_000);
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
  }, 30_000);
});

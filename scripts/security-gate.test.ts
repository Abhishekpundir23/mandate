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
  await cp('scripts/security-gate.mjs', join(root, 'scripts', 'security-gate.mjs'));
  await cp('scripts/security-built-policy.mjs', join(root, 'scripts', 'security-built-policy.mjs'));
  await cp('scripts/security-source-policy.mjs', join(root, 'scripts', 'security-source-policy.mjs'));
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

  it('standalone public security command rebuilds before scanning and replaces stale dist', async () => {
    const result = await runStandaloneSecurityWithStaleBuild();

    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/vite .* building client environment/i);
    expect(result.output).toMatch(/Built asset gate passed/);
  });
});

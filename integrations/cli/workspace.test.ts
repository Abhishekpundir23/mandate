import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getPolicyTemplate } from '../../src/policy/templates';
import { exampleCaseSuite } from '../../src/impact/examples';
import { recordSession } from '../../src/sessions/record';
import { verifyWorkspace } from '../../src/workspaces/bundle';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
let policy: string;
let session: string;
const run = (args: string[]) =>
  exec(process.execPath, [executable, ...args], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-workspace-'));
  policy = join(directory, 'policy.json');
  session = join(directory, 'session.json');
  const text = JSON.stringify(getPolicyTemplate('draft-only').policy);
  await writeFile(policy, text);
  await writeFile(
    session,
    JSON.stringify(recordSession(text, [exampleCaseSuite.cases[0]!.action], 'session')),
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('creates, verifies and inventories a self-contained workspace without modifying inputs', async () => {
  const original = await readFile(policy, 'utf8');
  const { stdout } = await run([
    'workspace',
    'create',
    '--policy',
    policy,
    '--session',
    session,
    '--workspace-id',
    'cli-workspace',
  ]);
  expect(verifyWorkspace(stdout).ok).toBe(true);
  const file = join(directory, 'workspace.json');
  await writeFile(file, stdout);
  expect(
    JSON.parse((await run(['workspace', 'verify', '--workspace', file])).stdout),
  ).toMatchObject({ valid: true, authenticated: false });
  expect(
    JSON.parse((await run(['workspace', 'inspect', '--workspace', file])).stdout).summary.kinds
      .SESSION,
  ).toBe(1);
  expect(await readFile(policy, 'utf8')).toBe(original);
});
test('adds, renames and explicitly cascades dependent entries to stdout', async () => {
  const file = join(directory, 'editing.json');
  await writeFile(
    file,
    (await run(['workspace', 'create', '--policy', policy, '--workspace-id', 'editing'])).stdout,
  );
  const entry = join(directory, 'entry.json');
  await writeFile(
    entry,
    JSON.stringify({
      id: 'cases',
      label: 'Cases',
      kind: 'CASES',
      references: ['policy'],
      payload: exampleCaseSuite,
    }),
  );
  const added = (await run(['workspace', 'add', '--workspace', file, '--entry', entry])).stdout;
  await writeFile(file, added);
  const renamed = JSON.parse(
    (
      await run([
        'workspace',
        'rename',
        '--workspace',
        file,
        '--entry-id',
        'policy',
        '--new-id',
        'authority',
      ])
    ).stdout,
  );
  expect(
    renamed.entries.find((item: { kind: string }) => item.kind === 'CASES').references,
  ).toEqual(['authority']);
  await expect(
    run(['workspace', 'remove', '--workspace', file, '--entry-id', 'policy']),
  ).rejects.toMatchObject({ code: 2 });
  const removed = JSON.parse(
    (await run(['workspace', 'remove', '--workspace', file, '--entry-id', 'policy', '--cascade']))
      .stdout,
  );
  expect(removed.entries).toEqual([]);
  expect(await readFile(file, 'utf8')).toBe(added);
});
test('redacted inventory respects validated filters and excludes payloads', async () => {
  const file = join(directory, 'redacted.json');
  await writeFile(
    file,
    (
      await run([
        'workspace',
        'create',
        '--policy',
        policy,
        '--session',
        session,
        '--workspace-id',
        'redacted',
      ])
    ).stdout,
  );
  const { stdout } = await run([
    'workspace',
    'inspect',
    '--workspace',
    file,
    '--redacted',
    '--kind',
    'SESSION',
  ]);
  expect(JSON.parse(stdout).entries).toHaveLength(1);
  expect(stdout).not.toContain('README.md');
  await expect(
    run(['workspace', 'inspect', '--workspace', file, '--redacted', '--page-size', '101']),
  ).rejects.toMatchObject({ code: 2 });
});
test('manifest tampering fails with exit 5 and bounded redacted diagnostics', async () => {
  const value = JSON.parse(
    (await run(['workspace', 'create', '--policy', policy, '--workspace-id', 'tamper'])).stdout,
  );
  value.label = 'secret-do-not-echo';
  const file = join(directory, 'tampered.json');
  await writeFile(file, JSON.stringify(value));
  await expect(run(['workspace', 'verify', '--workspace', file])).rejects.toMatchObject({
    code: 5,
  });
});

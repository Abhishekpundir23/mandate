import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { parsePolicyJson } from '../../src/policy/parse';
import { getPolicyTemplate } from '../../src/policy/templates';
import { retireClause } from '../../src/policy/revisions';
const exec = promisify(execFile);
let directory: string;
let policy: string;
let revision: string;
const executable = resolve('dist-cli/mandate.mjs');
const run = (args: string[]) => exec(process.execPath, [executable, ...args], { timeout: 5000 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-revision-'));
  policy = join(directory, 'policy.json');
  revision = join(directory, 'revision.json');
  const text = JSON.stringify(getPolicyTemplate('draft-only').policy);
  await writeFile(policy, text);
  await writeFile(revision, JSON.stringify(retireClause(parsePolicyJson(text), 'read', 'turn-2', 'Stop reading', 'stop-read')));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test('previews and applies to stdout without overwriting either input file', async () => {
  const baseline = await readFile(policy, 'utf8');
  const source = await readFile(revision, 'utf8');
  const preview = JSON.parse((await run(['policy', 'revision-preview', '--policy', policy, '--revision', revision])).stdout);
  expect(preview).toMatchObject({ beforeVersion: 2, afterVersion: 3, executionPerformed: false });
  expect(preview.changes.retired.map((c: { id: string }) => c.id)).toEqual(['read']);
  const applied = (await run(['policy', 'revision-apply', '--policy', policy, '--revision', revision])).stdout;
  expect(parsePolicyJson(applied).policyDigest).toBe(preview.afterDigest);
  expect(await readFile(policy, 'utf8')).toBe(baseline);
  expect(await readFile(revision, 'utf8')).toBe(source);
});
test('rejects stale, malformed and unsupported revisions with redacted stderr', async () => {
  const source = JSON.parse(await readFile(revision, 'utf8'));
  const file = join(directory, 'bad.json');
  for (const input of [{ ...source, expectedPolicyDigest: '0'.repeat(64) }, { secret: 'do-not-echo' }, '{']) {
    await writeFile(file, typeof input === 'string' ? input : JSON.stringify(input));
    await expect(run(['policy', 'revision-apply', '--policy', policy, '--revision', file])).rejects.toMatchObject({ code: 2, stdout: '', stderr: 'Mandate CLI: INVALID_INPUT\n' });
  }
});

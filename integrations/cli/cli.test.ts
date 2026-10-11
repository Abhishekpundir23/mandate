import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../../src/policy/templates';

let directory: string;
let policyFile: string;
let actionsFile: string;
const executable = resolve('dist-cli/mandate.mjs');
const read = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } };
const commit = { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };
const push = { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'a'.repeat(40) } };

interface RunResult { code: number | null; stdout: string; stderr: string }
function run(args: string[], cwd = directory): Promise<RunResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI did not exit')); }, 5000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timeout); resolveRun({ code, stdout, stderr }); });
  });
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-cli-'));
  policyFile = join(directory, 'policy.json');
  actionsFile = join(directory, 'actions.json');
  await writeFile(policyFile, JSON.stringify(getPolicyTemplate('draft-only').policy));
  await writeFile(actionsFile, JSON.stringify([read, push]));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('developer CLI command contracts', () => {
  test('prints discoverable help without reading a policy', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('policy validate');
    expect(result.stdout).toContain('session verify');
    expect(result.stderr).toBe('');
  });

  test('validates a policy and reports advisory metadata as JSON', async () => {
    const result = await run(['policy', 'validate', '--policy', policyFile]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: true, policyId: 'draft-only', contractVersion: 2, executionPerformed: false });
    expect(result.stderr).toBe('');
  });

  test('resolves explicit relative file arguments against the caller directory', async () => {
    const result = await run(['policy', 'validate', '--policy', 'policy.json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).valid).toBe(true);
  });

  test('supports readable inspection and historical versions', async () => {
    const text = await run(['policy', 'inspect', '--policy', policyFile, '--format', 'text']);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('draft-only');
    const bootstrap = await run(['policy', 'inspect', '--policy', policyFile, '--version', '1']);
    expect(JSON.parse(bootstrap.stdout).activeClauses).toEqual([]);
  });

  test('lists the actual history and compares bootstrap to active authority', async () => {
    const history = await run(['policy', 'history', '--policy', policyFile]);
    expect(JSON.parse(history.stdout).map((item: { version: number }) => item.version)).toEqual([1, 2]);
    const changes = await run(['policy', 'diff', '--policy', policyFile, '--before', '1', '--after', '2']);
    expect(JSON.parse(changes.stdout).activated.map((item: { id: string }) => item.id).sort()).toEqual(['commit', 'deny-push', 'read']);
  });

  test('analyzes policy authority without inventing an execution', async () => {
    const result = await run(['policy', 'lint', '--policy', policyFile]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).activeClauseCount).toBe(3);
  });

  test.each([[read, 0, 'ALLOW'], [push, 3, 'BLOCK']] as const)(
    'returns declared decision and exit code %#', async (action, code, outcome) => {
      const result = await run(['policy', 'check', '--policy', policyFile, '--action', JSON.stringify(action)]);
      expect(result.code).toBe(code);
      expect(JSON.parse(result.stdout)).toMatchObject({ executionPerformed: false, decision: { outcome } });
      expect(result.stderr).toBe('');
    },
  );

  test('returns CONFIRM with exit 4 and never takes a confirmation option', async () => {
    const file = join(directory, 'confirm.json');
    await writeFile(file, JSON.stringify(getPolicyTemplate('review-required').policy));
    const result = await run(['policy', 'check', '--policy', file, '--action', JSON.stringify(commit)]);
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout).decision.outcome).toBe('CONFIRM');
    const forged = await run(['policy', 'check', '--policy', file, '--action', JSON.stringify(commit), '--confirmation', 'yes']);
    expect(forged.code).toBe(2);
    expect(forged.stdout).toBe('');
  });

  test('reads an action file and enforces an explicitly expected policy digest', async () => {
    const actionFile = join(directory, 'action.json');
    await writeFile(actionFile, JSON.stringify(read));
    const result = await run(['policy', 'check', '--policy', policyFile, '--action-file', actionFile]);
    expect(result.code).toBe(0);
    const stale = await run(['policy', 'check', '--policy', policyFile, '--action-file', actionFile, '--expected-digest', '0'.repeat(64)]);
    expect(stale.code).toBe(2);
    expect(stale.stdout).toBe('');
  });

  test('records a batch as a verifiable session then inspects its declared outcomes', async () => {
    const created = await run(['session', 'create', '--policy', policyFile, '--actions', actionsFile, '--session-id', 'cli-audit', '--label', 'Local run']);
    expect(created.code).toBe(0);
    const session = JSON.parse(created.stdout);
    expect(session.records.map((item: { result: { decision: { outcome: string } } }) => item.result.decision.outcome)).toEqual(['ALLOW', 'BLOCK']);
    const file = join(directory, 'session.json');
    await writeFile(file, created.stdout);
    const verified = await run(['session', 'verify', '--session', file]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ valid: true, authenticated: false, recordCount: 2 });
    const inspected = await run(['session', 'inspect', '--session', file]);
    expect(JSON.parse(inspected.stdout).summary.outcomes).toEqual({ ALLOW: 1, BLOCK: 1, CONFIRM: 0 });
    const identical = await run(['session', 'diff', '--before', file, '--after', file]);
    expect(JSON.parse(identical.stdout).changes).toEqual([]);
  });

  test('reports invalid session integrity with exit 5', async () => {
    const created = await run(['session', 'create', '--policy', policyFile, '--actions', actionsFile, '--session-id', 'tamper']);
    const session = JSON.parse(created.stdout);
    session.records[1].result.decision.outcome = 'ALLOW';
    const file = join(directory, 'tampered.json');
    await writeFile(file, JSON.stringify(session));
    const result = await run(['session', 'verify', '--session', file]);
    expect(result.code).toBe(5);
    expect(JSON.parse(result.stdout).valid).toBe(false);
  });

  test('offers redacted inspection without returning policy text or file resources', async () => {
    const created = await run(['session', 'create', '--policy', policyFile, '--actions', actionsFile, '--session-id', 'redacted']);
    const file = join(directory, 'redacted.json');
    await writeFile(file, created.stdout);
    const result = await run(['session', 'inspect', '--session', file, '--redacted']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).kind).toBe('redacted-session-report');
    expect(result.stdout).not.toContain('README.md');
  });

  test('never reads the declared action target or changes the policy file', async () => {
    const before = await readFile(policyFile, 'utf8');
    const missing = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'not-a-real-file.txt' } };
    const result = await run(['policy', 'check', '--policy', policyFile, '--action', JSON.stringify(missing)]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).executionPerformed).toBe(false);
    expect(await readFile(policyFile, 'utf8')).toBe(before);
  });
});

describe('CLI input and process boundaries', () => {
  test.each([
    ['unknown'],
    ['policy', 'unknown'],
    ['policy', 'validate'],
    ['policy', 'validate', '--policy', 'policy.json', '--policy', 'policy.json'],
    ['policy', 'validate', '--policy', 'policy.json', '--format', 'xml'],
    ['policy', 'validate', '--policy'],
    ['policy', 'validate', '--policy', 'policy.json', '--typo', 'x'],
    ['policy', 'validate', '--policy', 'policy.json', 'unexpected'],
    ['policy', 'check', '--policy', 'policy.json', '--action', '{}', '--action-file', 'action.json'],
    ['policy', 'diff', '--policy', 'policy.json', '--before', 'NaN', '--after', '2'],
  ].map((args) => ({ args })))('rejects malformed arguments %# without stack output', async ({ args }) => {
    const result = await run(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Mandate CLI');
    expect(result.stderr).not.toContain(' at ');
  });

  test('redacts malformed file content and missing filenames from errors', async () => {
    const file = join(directory, 'invalid.json');
    await writeFile(file, '{"secret":"do-not-echo"}');
    const invalid = await run(['policy', 'validate', '--policy', file]);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).not.toContain('do-not-echo');
    const missing = await run(['policy', 'validate', '--policy', 'sensitive-filename-do-not-echo']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).not.toContain('sensitive-filename');
  });

  test('rejects invalid UTF-8 and oversized policy files', async () => {
    const file = join(directory, 'bytes.json');
    await writeFile(file, Buffer.from([0xff, 0xfe]));
    expect((await run(['policy', 'validate', '--policy', file])).code).toBe(2);
    await writeFile(file, ' '.repeat(262145));
    expect((await run(['policy', 'validate', '--policy', file])).code).toBe(2);
  });

  test('rejects directories and accepts an explicitly provided symlink to a regular file', async () => {
    const nested = join(directory, 'nested');
    await mkdir(nested);
    expect((await run(['policy', 'validate', '--policy', nested])).code).toBe(2);
    const linked = join(directory, 'linked.json');
    await symlink(policyFile, linked);
    expect((await run(['policy', 'validate', '--policy', linked])).code).toBe(0);
  });

  test('closed stdout exits without hanging or emitting an unhandled error', async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolveRun, reject) => {
      const child = spawn(process.execPath, [executable, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI pipe did not close')); }, 5000);
      child.stdout.destroy();
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('close', (code) => { clearTimeout(timeout); resolveRun({ code, stderr }); });
    });
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('Unhandled');
    expect(result.stderr).not.toContain('EPIPE');
  });
});

test('large session stdout remains within the session importer byte budget', async () => {
  const wide = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'x'.repeat(384) } };
  const file = join(directory, 'wide-actions.json');
  await writeFile(file, JSON.stringify(Array.from({ length: 500 }, () => wide)));
  const created = await run(['session', 'create', '--policy', policyFile, '--actions', file, '--session-id', 'wide']);
  expect(created.code).toBe(0);
  expect(Buffer.byteLength(created.stdout, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
  const sessionFile = join(directory, 'wide-session.json');
  await writeFile(sessionFile, created.stdout);
  const verified = await run(['session', 'verify', '--session', sessionFile]);
  expect(verified.code).toBe(0);
  expect(JSON.parse(verified.stdout).recordCount).toBe(500);
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { getPolicyTemplate } from '../../src/policy/templates';
import { exampleCaseSuite } from '../../src/impact/examples';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
let before: string;
let after: string;
let cases: string;
const run = (args: string[]) => exec(process.execPath, [executable, ...args], { timeout: 5000 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-impact-'));
  before = join(directory, 'before.json'); after = join(directory, 'after.json'); cases = join(directory, 'cases.json');
  await writeFile(before, JSON.stringify(getPolicyTemplate('draft-only').policy));
  await writeFile(after, JSON.stringify(getPolicyTemplate('review-required').policy));
  await writeFile(cases, JSON.stringify(exampleCaseSuite));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test('validates and compares actual declared cases', async () => {
  const valid = JSON.parse((await run(['impact', 'validate', '--cases', cases])).stdout);
  expect(valid).toMatchObject({ valid: true, caseCount: 3, executionPerformed: false });
  const report = JSON.parse((await run(['impact', 'run', '--before', before, '--after', after, '--cases', cases])).stdout);
  expect(report.cases.map((row: { after: { decision: { outcome: string } } }) => row.after.decision.outcome)).toEqual(['ALLOW', 'CONFIRM', 'BLOCK']);
});
test('compares historical authority and provides a redacted output', async () => {
  const report = JSON.parse((await run(['impact', 'history', '--policy', before, '--before', '1', '--after', '2', '--cases', cases])).stdout);
  expect(report.cases[0]).toMatchObject({ outcomeChanged: true, before: { decision: { outcome: 'BLOCK' } }, after: { decision: { outcome: 'ALLOW' } } });
  const { stdout } = await run(['impact', 'run', '--before', before, '--after', after, '--cases', cases, '--redacted']);
  expect(JSON.parse(stdout).replayable).toBe(false);
  expect(stdout).not.toContain('README.md');
});
test('expectation failure uses exit 5 while preserving the actual report', async () => {
  const file = join(directory, 'wrong.json');
  await writeFile(file, JSON.stringify({ ...exampleCaseSuite, cases: [{ ...exampleCaseSuite.cases[0], expected: { after: 'BLOCK' } }] }));
  await expect(run(['impact', 'run', '--before', before, '--after', after, '--cases', file])).rejects.toMatchObject({ code: 5 });
});
test('scope and case errors return redacted input errors', async () => {
  const file = join(directory, 'invalid.json');
  await writeFile(file, '{"secret":"do-not-echo"}');
  await expect(run(['impact', 'run', '--before', before, '--after', after, '--cases', file])).rejects.toMatchObject({ code: 2, stdout: '', stderr: 'Mandate CLI: INVALID_INPUT\n' });
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
const run = (args: string[]) =>
  exec(process.execPath, [executable, ...args], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-qualification-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('exports, validates, runs, verifies and compares self-contained qualification reports', async () => {
  const example = (await run(['qualification', 'example'])).stdout;
  const file = join(directory, 'profile.json');
  await writeFile(file, example);
  expect(
    JSON.parse((await run(['qualification', 'validate', '--profile', file])).stdout).valid,
  ).toBe(true);
  const report = (await run(['qualification', 'run', '--profile', file])).stdout;
  const saved = join(directory, 'report.json');
  await writeFile(saved, report);
  expect(JSON.parse((await run(['qualification', 'verify', '--report', saved])).stdout).valid).toBe(
    true,
  );
  expect(
    JSON.parse(
      (await run(['qualification', 'compare', '--before', saved, '--after', saved])).stdout,
    ).profileChanged,
  ).toBe(false);
});
test('failing criteria and corrupt reports use exit 5 while malformed input uses exit 2', async () => {
  const profile = JSON.parse((await run(['qualification', 'example'])).stdout);
  profile.criteria.maximumOutcomes.ALLOW = 0;
  const file = join(directory, 'failing.json');
  await writeFile(file, JSON.stringify(profile));
  await expect(run(['qualification', 'run', '--profile', file])).rejects.toMatchObject({ code: 5 });
  await writeFile(file, '{}');
  await expect(run(['qualification', 'verify', '--report', file])).rejects.toMatchObject({
    code: 5,
  });
  await expect(run(['qualification', 'run', '--profile', file])).rejects.toMatchObject({ code: 2 });
});
test('redacted output omits sources and action arguments', async () => {
  const file = join(directory, 'redacted.json');
  await writeFile(file, (await run(['qualification', 'example'])).stdout);
  const { stdout } = await run(['qualification', 'run', '--profile', file, '--redacted']);
  expect(JSON.parse(stdout).replayable).toBe(false);
  expect(stdout).not.toContain('README.md');
});

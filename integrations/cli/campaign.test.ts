import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { maintainedCampaign } from '../../src/campaigns/catalog';
import { serializeCampaign } from '../../src/campaigns/schema';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
let campaign: string;
const run = (args: string[]) =>
  exec(process.execPath, [executable, ...args], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-campaign-'));
  campaign = join(directory, 'campaign.json');
  await writeFile(campaign, serializeCampaign(maintainedCampaign));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('exports and runs the maintained campaign with the same literal invariants', async () => {
  const exported = JSON.parse((await run(['campaign', 'example'])).stdout);
  expect(exported).toEqual(maintainedCampaign);
  const valid = JSON.parse((await run(['campaign', 'validate', '--campaign', campaign])).stdout);
  expect(valid.valid).toBe(true);
  const report = JSON.parse((await run(['campaign', 'run', '--campaign', campaign])).stdout);
  expect(report.cases.every((row: { passed: boolean }) => row.passed)).toBe(true);
  expect(report.externalActionsPerformed).toBe(false);
});
test('failed expectations exit 5 and redacted reports preserve actual verdicts', async () => {
  const source = JSON.parse(serializeCampaign(maintainedCampaign));
  source.cases = [source.cases.find((row: { id: string }) => row.id === 'trace-control')];
  source.cases[0].expected.verification = 'REJECT';
  const file = join(directory, 'wrong.json');
  await writeFile(file, JSON.stringify(source));
  await expect(run(['campaign', 'run', '--campaign', file])).rejects.toMatchObject({ code: 5 });
  const { stdout } = await run(['campaign', 'run', '--campaign', campaign, '--redacted']);
  expect(JSON.parse(stdout).summary.failed).toBe(0);
  expect(stdout).not.toContain('trace-control');
});
test('rejects malformed campaign files with redacted input errors', async () => {
  const file = join(directory, 'bad.json');
  await writeFile(file, '{"secret":"do-not-echo"}');
  await expect(run(['campaign', 'run', '--campaign', file])).rejects.toMatchObject({
    code: 2,
    stdout: '',
    stderr: 'Mandate CLI: INVALID_INPUT\n',
  });
});

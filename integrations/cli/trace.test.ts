import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { scenarioCatalog } from '../../src/scenarios/catalog';
import { verifyTraceBundle } from '../../src/inspection/bundle';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
let scenario: string;
const run = (args: string[]) => exec(process.execPath, [executable, ...args], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-trace-'));
  scenario = join(directory, 'scenario.json');
  await writeFile(scenario, JSON.stringify(scenarioCatalog[0]));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test('creates a reproducible bundle, verifies it and inspects independent evidence', async () => {
  const { stdout } = await run(['trace', 'create', '--scenario', scenario]);
  expect(verifyTraceBundle(stdout).ok).toBe(true);
  const file = join(directory, 'bundle.json'); await writeFile(file, stdout);
  const verified = JSON.parse((await run(['trace', 'verify', '--bundle', file])).stdout);
  expect(verified).toMatchObject({ valid: true, authenticated: false });
  const report = JSON.parse((await run(['trace', 'inspect', '--bundle', file])).stdout);
  expect(report.summary).toMatchObject({ blocks: 1, unverifiedClaims: 0 });
  expect(report.graph.edges.some((edge: { kind: string }) => edge.kind === 'claim-evidence')).toBe(true);
  const standard = JSON.parse((await run(['trace', 'inspect', '--bundle', file, '--lane', 'standard'])).stdout);
  expect(standard.diagnostics.some((issue: { code: string }) => issue.code === 'UNAUTHORIZED_EFFECT')).toBe(true);
  const redacted = (await run(['trace', 'inspect', '--bundle', file, '--redacted'])).stdout;
  expect(JSON.parse(redacted).replayable).toBe(false);
  expect(redacted).not.toContain('draftSaved');
});
test('modified bundle verification exits 5 with a redacted reason', async () => {
  const bundle = JSON.parse((await run(['trace', 'create', '--scenario', scenario])).stdout);
  bundle.comparison.mandate.receipt.exactMandateSuccess = false;
  const file = join(directory, 'tampered.json'); await writeFile(file, JSON.stringify(bundle));
  await expect(run(['trace', 'verify', '--bundle', file])).rejects.toMatchObject({ code: 5 });
  await expect(run(['trace', 'inspect', '--bundle', file])).rejects.toMatchObject({ code: 2, stderr: 'Mandate CLI: INVALID_INPUT\n' });
});
test('rejects invalid lane and missing file without disclosing the path', async () => {
  const file = join(directory, 'valid.json');
  await writeFile(file, (await run(['trace', 'create', '--scenario', scenario])).stdout);
  await expect(run(['trace', 'inspect', '--bundle', file, '--lane', 'private-lane'])).rejects.toMatchObject({ code: 2, stderr: 'Mandate CLI: INVALID_INPUT\n' });
  await expect(run(['trace', 'verify', '--bundle', '/private-do-not-echo'])).rejects.toMatchObject({ code: 2, stderr: 'Mandate CLI: INVALID_INPUT\n' });
});

test('supports bounded event pages and combined event/outcome filters', async () => {
  const file = join(directory, 'query.json');
  await writeFile(file, (await run(['trace', 'create', '--scenario', scenario])).stdout);
  const page = JSON.parse((await run(['trace', 'inspect', '--bundle', file, '--page', '2', '--page-size', '1'])).stdout);
  expect(page.events.items[0].logicalStep).toBe(2);
  expect(page.events.pageSize).toBe(1);
  const filtered = JSON.parse((await run(['trace', 'inspect', '--bundle', file, '--type', 'GATE_DECISION', '--outcome', 'BLOCK'])).stdout);
  expect(filtered.events.total).toBe(1);
  expect(filtered.events.items[0].proposalId).toBe('submit-application');
  await expect(run(['trace', 'inspect', '--bundle', file, '--page-size', '101'])).rejects.toMatchObject({ code: 2 });
  await expect(run(['trace', 'inspect', '--bundle', file, '--outcome', 'SUCCESS'])).rejects.toMatchObject({ code: 2 });
});

test('redacted inspection applies the same validated event filters', async () => {
  const file = join(directory, 'redacted-query.json');
  await writeFile(file, (await run(['trace', 'create', '--scenario', scenario])).stdout);
  const report = JSON.parse((await run(['trace', 'inspect', '--bundle', file, '--redacted', '--outcome', 'BLOCK'])).stdout);
  expect(report.events).toHaveLength(1);
  expect(report.events[0].outcome).toBe('BLOCK');
  await expect(run(['trace', 'inspect', '--bundle', file, '--redacted', '--page-size', '101'])).rejects.toMatchObject({ code: 2 });
});

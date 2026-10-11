import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../../src/scenarios/catalog';

const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
let scenarioFile: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-lab-'));
  scenarioFile = join(directory, 'scenario.json');
  await writeFile(scenarioFile, JSON.stringify(scenarioCatalog[0]));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
const run = (args: string[]) =>
  exec(process.execPath, [executable, ...args], {
    cwd: directory,
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });

describe('CLI scenario lab', () => {
  test('lists canonical scenarios separately from policy experiments', async () => {
    const { stdout } = await run(['lab', 'list']);
    const list = JSON.parse(stdout);
    expect(list.scenarios).toHaveLength(15);
    expect(list.experiments.length).toBeGreaterThanOrEqual(24);
    expect(list.scenarios[0].id).toBe('draft-is-not-submit');
  });
  test('validates a bounded custom scenario without running it', async () => {
    const { stdout } = await run(['lab', 'validate', '--scenario', scenarioFile]);
    expect(JSON.parse(stdout)).toMatchObject({
      valid: true,
      scenarioId: 'draft-is-not-submit',
      externalActionsPerformed: false,
    });
  });
  test('runs paired sandbox scoring with explicit synthetic metadata', async () => {
    const { stdout } = await run(['lab', 'run', '--scenario', scenarioFile]);
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'deterministic-sandbox',
      externalActionsPerformed: false,
      scores: { standard: { exactMandateSuccess: false }, mandate: { exactMandateSuccess: true } },
    });
  });
  test('runs a maintained advisory experiment by ID', async () => {
    const { stdout } = await run(['lab', 'run', '--experiment', 'denial-wins']);
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'advisory',
      executionPerformed: false,
      passed: true,
    });
  });
  test('rejects an unknown experiment without leaking its value', async () => {
    await expect(run(['lab', 'run', '--experiment', 'private-do-not-echo'])).rejects.toMatchObject({
      code: 2,
      stdout: '',
      stderr: 'Mandate CLI: INVALID_INPUT\n',
    });
  });
  test('requires exactly one run source', async () => {
    await expect(run(['lab', 'run'])).rejects.toMatchObject({ code: 2 });
    await expect(
      run(['lab', 'run', '--scenario', scenarioFile, '--experiment', 'denial-wins']),
    ).rejects.toMatchObject({ code: 2 });
  });
  test('rejects an unsupported host operation before any execution', async () => {
    const value = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    value.proposalProgram.main[0].action.tool = 'shell';
    const file = join(directory, 'unsafe.json');
    await writeFile(file, JSON.stringify(value));
    await expect(run(['lab', 'run', '--scenario', file])).rejects.toMatchObject({
      code: 2,
      stdout: '',
    });
  });
});

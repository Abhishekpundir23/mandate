import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { compileRecipe, recipeFromScenario } from '../../src/authoring/index';
import { scenarioCatalog } from '../../src/scenarios/catalog';
import { parseLabScenario } from '../../src/lab/parse';
const exec = promisify(execFile);
const executable = resolve('dist-cli/mandate.mjs');
let directory: string;
const run = (args: string[]) => exec(process.execPath, [executable, ...args], { timeout: 10000 });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mandate-recipe-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
test('exports a recipe and compiles and runs it without changing canonical fixtures', async () => {
  const example = (await run(['recipe', 'example', '--scenario-id', 'draft-is-not-submit'])).stdout;
  const file = join(directory, 'recipe.json');
  await writeFile(file, example);
  expect(JSON.parse((await run(['recipe', 'validate', '--recipe', file])).stdout).valid).toBe(true);
  expect(parseLabScenario((await run(['recipe', 'compile', '--recipe', file])).stdout).id).toBe(
    'draft-is-not-submit',
  );
  expect(
    JSON.parse((await run(['recipe', 'run', '--recipe', file])).stdout).report
      .externalActionsPerformed,
  ).toBe(false);
});
test('lists capabilities and rejects unknown scenario IDs and malformed recipes', async () => {
  expect(JSON.parse((await run(['recipe', 'capabilities'])).stdout).length).toBeGreaterThan(20);
  await expect(run(['recipe', 'example', '--scenario-id', 'missing'])).rejects.toMatchObject({
    code: 2,
  });
  const file = join(directory, 'invalid.json');
  await writeFile(file, '{}');
  await expect(run(['recipe', 'compile', '--recipe', file])).rejects.toMatchObject({ code: 2 });
});

test('compiled JSON remains importable near the scenario byte boundary', async () => {
  const recipe = JSON.parse(JSON.stringify(recipeFromScenario(scenarioCatalog[0]!)));
  recipe.initialWorld.padding = '';
  const baseline = JSON.stringify(compileRecipe(recipe));
  recipe.initialWorld.padding = 'x'.repeat(256 * 1024 - Buffer.byteLength(baseline) - 20);
  const file = join(directory, 'wide-recipe.json');
  await writeFile(file, JSON.stringify(recipe));
  const output = (await run(['recipe', 'compile', '--recipe', file])).stdout;
  expect(() => parseLabScenario(output)).not.toThrow();
});

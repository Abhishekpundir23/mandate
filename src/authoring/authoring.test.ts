import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { capabilityRegistry } from '../sandbox/capabilities';
import { fingerprintAction } from '../domain/canonical';
import { compileRecipe, parseRecipe, recipeFromScenario, serializeRecipe, previewRecipe, capabilityInventory } from './index';
describe('explicit scenario recipes', () => {
  test.each(scenarioCatalog)('reconstructs $id without inferred authority or oracle changes', (scenario) => {
    const recipe = recipeFromScenario(scenario);
    expect(compileRecipe(parseRecipe(serializeRecipe(recipe)))).toEqual(scenario);
    expect(JSON.stringify(recipe)).not.toContain('baseVersion');
    expect(JSON.stringify(recipe)).not.toContain('fingerprint');
    for (const turn of compileRecipe(recipe).turns) {
      expect(turn.canonicalDiff.source).toEqual({ turnId: turn.id, quote: turn.text });
    }
  });
  test('catalog covers each supported capability family and inventory exposes data only', () => {
    const inventory = capabilityInventory();
    expect(inventory).toHaveLength(Object.keys(capabilityRegistry).length);
    expect(new Set(inventory.map((entry) => entry.tool)).size).toBeGreaterThanOrEqual(15);
    expect(JSON.stringify(inventory)).not.toContain('reduce');
    expect(Object.isFrozen(inventory)).toBe(true);
  });
  test('derives capability effects, resources and fingerprints from validated arguments', () => {
    const scenario = compileRecipe(recipeFromScenario(scenarioCatalog[0]!));
    for (const proposal of scenario.proposalProgram.main) if (proposal.kind === 'ACTION') {
      expect(proposal.action.fingerprint).toBe(fingerprintAction(proposal.action));
    }
  });
  test.each(['effect', 'resource', 'fingerprint'])('rejects caller supplied action %s', (field) => {
    const recipe = JSON.parse(serializeRecipe(recipeFromScenario(scenarioCatalog[0]!)));
    const action = recipe.proposalProgram.main.find((item: {kind: string}) => item.kind === 'ACTION');
    action.action[field] = 'forged'; expect(() => compileRecipe(recipe)).toThrow();
  });
  test('unknown capabilities, arguments and proposal ordering fail closed', () => {
    for (const mutate of [
      (value: ReturnType<typeof JSON.parse>) => { value.proposalProgram.main.find((p: ReturnType<typeof JSON.parse>) => p.kind === 'ACTION').action.tool = 'unknown'; },
      (value: ReturnType<typeof JSON.parse>) => { value.proposalProgram.main.find((p: ReturnType<typeof JSON.parse>) => p.kind === 'ACTION').action.args.extra = true; },
      (value: ReturnType<typeof JSON.parse>) => { value.proposalProgram.main[0].afterTurn = 'missing'; },
      (value: ReturnType<typeof JSON.parse>) => { value.turns[0].operations[0].clause.source = { turnId: 'spoof', quote: 'spoof' }; },
    ]) {
      const recipe = JSON.parse(serializeRecipe(recipeFromScenario(scenarioCatalog[0]!))); mutate(recipe);
      expect(() => compileRecipe(recipe)).toThrow();
    }
  });
  test('recovery recipes preserve targets and reject unknown targets', () => {
    const source = scenarioCatalog.find((scenario) => Object.keys(scenario.proposalProgram.onRejected ?? {}).length > 0)!;
    const recipe = recipeFromScenario(source); expect(compileRecipe(recipe)).toEqual(source);
    const forged = JSON.parse(serializeRecipe(recipe)); forged.proposalProgram.onRejected = { missing: [] };
    expect(() => compileRecipe(forged)).toThrow();
  });
  test('ambiguous prose grants no permission without explicit operations', () => {
    const recipe = JSON.parse(serializeRecipe(recipeFromScenario(scenarioCatalog[0]!)));
    recipe.turns = [{ id: 't', text: 'Perhaps submit?', operations: [{ op: 'NO_CHANGE', reason: 'AMBIGUOUS' }] }];
    recipe.proposalProgram = { main: [] };
    expect(compileRecipe(recipe).turns[0]!.canonicalDiff.ops).toEqual([{ op: 'NO_CHANGE', reason: 'AMBIGUOUS' }]);
  });
  test('bounded import rejects deep, oversized, cyclic and accessor data', () => {
    expect(() => parseRecipe(' '.repeat(256 * 1024 + 1))).toThrow();
    expect(() => parseRecipe('['.repeat(33) + '0' + ']'.repeat(33))).toThrow();
    let calls = 0; const forged = Object.defineProperty({}, 'turns', { enumerable: true, get() { calls++; return []; } });
    expect(() => compileRecipe(forged)).toThrow(); expect(calls).toBe(0);
    const cycle: ReturnType<typeof JSON.parse> = {}; cycle.self = cycle; expect(() => compileRecipe(cycle)).toThrow();
  });
  test('preview runs the actual deterministic sandbox with explicit scores', () => {
    const preview = previewRecipe(recipeFromScenario(scenarioCatalog[0]!));
    expect(preview.report.externalActionsPerformed).toBe(false);
    expect(preview.report.scores.mandate.exactMandateSuccess).toBe(true);
    expect(preview.scenarioDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});

import { canonicalize, fingerprintAction, normalizeJsonValue } from '../domain/canonical';
import type { ActionProposal, Proposal, ScenarioDefinition } from '../domain/types';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { sha256 } from '../policy/sha256';
import { utf8Length } from '../policy/utf8';
import { getCapability } from '../sandbox/capabilities';
import { parseLabScenario } from '../lab/parse';
import { runLabScenario } from '../lab/run';
import { recipeLimits, recipeSchema } from './schema';
import type { RecipeProposal, ScenarioRecipe } from './schema';
export function parseRecipe(text: string): ScenarioRecipe {
  return freezeData(recipeSchema.parse(parseBoundedJson(text, recipeLimits)));
}
export function validateRecipe(input: unknown): ScenarioRecipe {
  return freezeData(recipeSchema.parse(normalizeBoundedJson(input, recipeLimits)));
}
function compileProposal(proposal: RecipeProposal): unknown {
  if (proposal.kind !== 'ACTION') return proposal;
  const definition = getCapability(proposal.action.tool, proposal.action.operation);
  if (definition === undefined) throw new Error('Unknown recipe capability');
  const args = definition.argumentsSchema.parse(proposal.action.args);
  const action = {
    ...proposal.action,
    args,
    effect: definition.effect,
    resource: definition.deriveResource(args),
  };
  return {
    ...proposal,
    action: { ...action, fingerprint: fingerprintAction({ ...action, fingerprint: '' }) },
  };
}
export function compileRecipe(input: unknown): ScenarioDefinition {
  const recipe = validateRecipe(input);
  const scenario = {
    schemaVersion: 1,
    id: recipe.id,
    title: recipe.title,
    domain: recipe.domain,
    seed: recipe.seed,
    initialWorld: recipe.initialWorld,
    turns: recipe.turns.map((turn, index) => {
      const source = { turnId: turn.id, quote: turn.text };
      return {
        id: turn.id,
        text: turn.text,
        canonicalDiff: {
          baseVersion: index,
          turnId: turn.id,
          source,
          ops: turn.operations.map((op) =>
            op.op === 'NO_CHANGE'
              ? op
              : op.op === 'ADD'
                ? { ...op, clause: { ...op.clause, source } }
                : op.op === 'REVOKE'
                  ? { ...op, tombstone: { ...op.tombstone, source } }
                  : { ...op, replacement: { ...op.replacement, source } },
          ),
        },
      };
    }),
    proposalProgram: {
      main: recipe.proposalProgram.main.map(compileProposal),
      ...(recipe.proposalProgram.onRejected === undefined
        ? {}
        : {
            onRejected: Object.fromEntries(
              Object.entries(recipe.proposalProgram.onRejected).map(([id, entries]) => [
                id,
                entries.map(compileProposal),
              ]),
            ),
          }),
    },
    oracle: recipe.oracle,
  };
  return parseLabScenario(JSON.stringify(scenario));
}
function recipeAction(action: ActionProposal) {
  return {
    id: action.id,
    stepId: action.stepId,
    tool: action.tool,
    operation: action.operation,
    args: action.args,
  };
}
function recipeProposal(proposal: Proposal): unknown {
  return proposal.kind === 'ACTION'
    ? { ...proposal, action: recipeAction(proposal.action) }
    : proposal;
}
export function recipeFromScenario(input: ScenarioDefinition): ScenarioRecipe {
  const scenario = parseLabScenario(JSON.stringify(normalizeBoundedJson(input, recipeLimits)));
  const removeSource = <T extends { readonly source: unknown }>(clause: T) => {
    const { source, ...rest } = clause;
    void source;
    return rest;
  };
  return validateRecipe({
    schemaVersion: 1,
    kind: 'scenario-recipe',
    id: scenario.id,
    title: scenario.title,
    domain: scenario.domain,
    seed: scenario.seed,
    initialWorld: scenario.initialWorld,
    turns: scenario.turns.map((turn) => ({
      id: turn.id,
      text: turn.text,
      operations: turn.canonicalDiff.ops.map((op) =>
        op.op === 'NO_CHANGE'
          ? op
          : op.op === 'ADD'
            ? { ...op, clause: removeSource(op.clause) }
            : op.op === 'REVOKE'
              ? { ...op, tombstone: removeSource(op.tombstone) }
              : { ...op, replacement: removeSource(op.replacement) },
      ),
    })),
    proposalProgram: {
      main: scenario.proposalProgram.main.map(recipeProposal),
      ...(scenario.proposalProgram.onRejected === undefined
        ? {}
        : {
            onRejected: Object.fromEntries(
              Object.entries(scenario.proposalProgram.onRejected).map(([id, entries]) => [
                id,
                entries.map(recipeProposal),
              ]),
            ),
          }),
    },
    oracle: scenario.oracle,
  });
}
export function serializeRecipe(input: unknown): string {
  const recipe = validateRecipe(input);
  const pretty = JSON.stringify(recipe, null, 2);
  return utf8Length(pretty) <= recipeLimits.bytes ? pretty : JSON.stringify(recipe);
}
export function previewRecipe(input: unknown) {
  const scenario = compileRecipe(input);
  return freezeData({
    scenario,
    scenarioDigest: sha256(canonicalize(normalizeJsonValue(scenario))),
    report: runLabScenario(scenario),
  });
}

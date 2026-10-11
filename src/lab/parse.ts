import { canonicalize, fingerprintAction, normalizeJsonValue } from '../domain/canonical';
import { parseScenarioFixture } from '../domain/schema';
import type { ContractVersion, JsonValue, Proposal, ScenarioDefinition } from '../domain/types';
import { parseBoundedJson, policyJsonLimits } from '../policy/json';
import { appendCanonicalTurn } from '../runtime/runner-support';
import { validateCapability } from '../sandbox/capabilities';

export const labLimits = Object.freeze({ ...policyJsonLimits, turns: 64, proposals: 256, suite: 100 });

/** Strict boundary around the fixture parser, whose legacy objects permit unknown keys. */
export function parseLabScenario(text: string): ScenarioDefinition {
  const raw = parseBoundedJson(text, labLimits);
  const scenario = parseScenarioFixture(raw);
  if (canonicalize(normalizeJsonValue(scenario)) !== canonicalize(raw)) {
    throw new Error('Unknown or altered scenario fields');
  }
  if (scenario.turns.length > labLimits.turns) throw new Error('Scenario turn limit');
  const recovery = scenario.proposalProgram.onRejected ?? {};
  const proposals = [...scenario.proposalProgram.main, ...Object.values(recovery).flat()];
  if (proposals.length > labLimits.proposals) throw new Error('Scenario proposal limit');

  const turnIndices = new Map(scenario.turns.map((turn, index) => [turn.id, index]));
  let versions: readonly ContractVersion[] = [];
  for (const [index, turn] of scenario.turns.entries()) {
    if (turn.canonicalDiff.baseVersion !== index) throw new Error('Scenario base version mismatch');
    const known = new Set(versions.at(-1)?.clauses.map((clause) => clause.id) ?? []);
    const added: string[] = [];
    const evidenceTargets: string[] = [];
    for (const op of turn.canonicalDiff.ops) {
      if (op.op === 'NO_CHANGE') continue;
      const clause = op.op === 'ADD' ? op.clause : op.op === 'REPLACE' ? op.replacement : op.tombstone;
      if (clause.source.turnId !== turn.id || clause.source.quote !== turn.text) {
        throw new Error('Scenario clause provenance mismatch');
      }
      if (op.op === 'REVOKE' ? clause.kind !== 'REVOKED' : clause.kind === 'REVOKED') {
        throw new Error('Scenario revocation shape mismatch');
      }
      if (clause.kind === 'NEEDS_CONFIRMATION' ? clause.afterConfirmation === undefined : clause.afterConfirmation !== undefined) {
        throw new Error('Scenario confirmation shape mismatch');
      }
      if (clause.kind === 'EVIDENCE' ? clause.evidenceRequirement === undefined : clause.evidenceRequirement !== undefined) {
        throw new Error('Scenario evidence shape mismatch');
      }
      if (clause.kind !== 'EVIDENCE' && clause.kind !== 'REVOKED' && clause.selector === undefined) {
        throw new Error('Missing scenario selector');
      }
      if (clause.kind !== 'REVOKED' && (clause.targetClauseIds !== undefined || clause.revokedSelector !== undefined)) {
        throw new Error('Scenario target shape mismatch');
      }
      if (clause.kind === 'REVOKED' && (clause.selector !== undefined
        || ((clause.targetClauseIds?.length ?? 0) === 0 && clause.revokedSelector === undefined))) {
        throw new Error('Invalid scenario revocation');
      }
      const targets = op.op === 'REPLACE' ? op.targetClauseIds : clause.targetClauseIds ?? [];
      if (new Set(targets).size !== targets.length) throw new Error('Duplicate scenario targets');
      if (clause.evidenceRequirement !== undefined) evidenceTargets.push(clause.evidenceRequirement.forClauseId);
      added.push(clause.id, ...(op.op === 'REPLACE' ? op.targetClauseIds.map((id) => turn.id + ':revoke:' + id) : []));
    }
    if (new Set(added).size !== added.length || added.some((id) => known.has(id))) {
      throw new Error('Duplicate scenario clause ID');
    }
    const resultingIds = new Set([...known, ...added]);
    if (evidenceTargets.some((id) => !resultingIds.has(id))) throw new Error('Unknown scenario evidence target');
    versions = appendCanonicalTurn(versions, turn);
  }

  const mainActions = new Map(scenario.proposalProgram.main.flatMap((proposal) =>
    proposal.kind === 'ACTION' ? [[proposal.action.id, proposal] as const] : []));
  const actionIds = new Set(proposals.flatMap((proposal) => proposal.kind === 'ACTION' ? [proposal.action.id] : []));
  let lastTurn = -1;
  for (const proposal of scenario.proposalProgram.main) {
    const index = turnIndices.get(proposal.afterTurn);
    if (index === undefined || index < lastTurn) throw new Error('Scenario proposal turn order mismatch');
    lastTurn = index;
  }
  for (const [id, entries] of Object.entries(recovery)) {
    const main = mainActions.get(id);
    if (main === undefined) throw new Error('Recovery must target a main action');
    if (entries.some((proposal) => proposal.afterTurn !== main.afterTurn)) throw new Error('Recovery turn mismatch');
  }
  for (const proposal of proposals) validateProposal(proposal, turnIndices, actionIds);
  return scenario;
}

function validateProposal(proposal: Proposal, turns: ReadonlyMap<string, number>, actions: ReadonlySet<string>): void {
  if (!turns.has(proposal.afterTurn)) throw new Error('Unknown scenario proposal turn');
  if (proposal.kind === 'ASK_CONFIRMATION' && !actions.has(proposal.actionRef)) {
    throw new Error('Unknown scenario confirmation action');
  }
  if (proposal.kind !== 'ACTION') return;
  const action = proposal.action;
  if (fingerprintAction(action) !== action.fingerprint) throw new Error('Scenario action fingerprint mismatch');
  const result = validateCapability({ ...action, args: normalizeJsonValue(action.args) as Readonly<Record<string, JsonValue>> });
  if (!result.ok || result.resource !== action.resource || !result.effects.includes(action.effect)) {
    throw new Error('Unsupported scenario capability');
  }
}

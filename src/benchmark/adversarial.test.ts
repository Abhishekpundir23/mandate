import { describe, expect, it } from 'vitest';

import { parseScenarioFixture } from '../domain/schema';
import type { Clause, Proposal, ScenarioDefinition } from '../domain/types';
import { rebuildFixtureAuthority } from '../evidence/authority';
import { runComparison, runScenario } from '../runtime/runner';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import { scenarioCatalog } from '../scenarios/catalog';
import { runBenchmark } from './evaluate';
import {
  actionForEvent,
  claimIsVerified,
  deepFreeze,
  denialMatches,
  executionIsValid,
  recoverySucceeded,
  selectorMatches,
  successfulExecutions,
  supportingEvidence,
} from './fixture-evaluator';
import { aggregateMetrics } from './metrics';
import { assertBenchmarkCoherent } from './snapshot-validation';
import { lifecycleMatches } from './trace-lifecycle';

function benchmarkInput() {
  return {
    scenarios: scenarioCatalog,
    report: runBenchmark(scenarioCatalog),
    comparisons: scenarioCatalog.map(runComparison),
  };
}

describe('benchmark adversarial boundaries', () => {
  it('matches selectors field-by-field and resolves both denial forms without trusting presentation data', () => {
    const action = draftIsNotSubmit.proposalProgram.main.find((proposal) =>
      proposal.kind === 'ACTION' && proposal.action.id === 'submit-application');
    if (action?.kind !== 'ACTION') throw new Error('Submit action is required.');
    const version = rebuildFixtureAuthority(draftIsNotSubmit).versions.at(-1)!;
    const targetGrant = version.clauses.find(({ id }) => id === 'inspect-next-step-may')!;
    const selectorTombstone: Clause = {
      id: 'selector-tombstone',
      kind: 'REVOKED',
      statement: 'Submission revoked.',
      introducedIn: 3,
      source: version.source,
      revokedSelector: { operation: 'submit' },
    };
    const targetTombstone: Clause = {
      id: 'target-tombstone',
      kind: 'REVOKED',
      statement: 'Target authority revoked.',
      targetClauseIds: [targetGrant.id],
      introducedIn: 3,
      source: version.source,
    };

    expect(selectorMatches(action.action, undefined)).toBe(false);
    expect(selectorMatches(action.action, {})).toBe(true);
    expect(selectorMatches(action.action, { tool: 'invented' })).toBe(false);
    expect(selectorMatches(action.action, { operation: 'invented' })).toBe(false);
    expect(selectorMatches(action.action, { resource: 'other' })).toBe(false);
    expect(selectorMatches(action.action, { effect: 'READ' })).toBe(false);
    expect(denialMatches(action.action, { ...selectorTombstone, kind: 'MAY' }, version)).toBe(false);
    expect(denialMatches(action.action, selectorTombstone, version)).toBe(true);
    expect(denialMatches(action.action, targetTombstone, version)).toBe(false);
  });

  it('validates execution identity, metadata, facts, and reducer output independently', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const event = trace.events.find((candidate) =>
      candidate.type === 'TOOL_OBSERVATION' && candidate.proposalId === 'save-draft');
    const action = actionForEvent(event!, draftIsNotSubmit);
    if (event === undefined || action === undefined) throw new Error('Save-draft execution is required.');

    expect(executionIsValid(trace, event, action)).toBe(true);
    expect(executionIsValid(trace, { ...event, operation: 'invented' }, action)).toBe(false);
    expect(executionIsValid(trace, { ...event, observation: { ...event.observation!, actionId: 'other' } }, action)).toBe(false);
    expect(executionIsValid(trace, { ...event, facts: { draftSaved: false } }, action)).toBe(false);
    expect(executionIsValid(trace, { ...event, id: 'event-wrong' }, action)).toBe(false);
    expect(actionForEvent({ ...event, proposalId: 'invented' }, draftIsNotSubmit)).toBeUndefined();
  });

  it('requires timely observation evidence and complete recovery proposal traces', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const executions = successfulExecutions(trace, draftIsNotSubmit);
    const predicate = { op: 'eq' as const, path: 'draftSaved', value: true };
    const claim = trace.events.find((event) => event.type === 'CLAIM_EVALUATED')!;

    expect(supportingEvidence(executions, [predicate], trace.world)).toBe(true);
    expect(supportingEvidence(executions, [predicate], trace.world, 1)).toBe(false);
    expect(supportingEvidence(executions, [{ ...predicate, value: false }], trace.world)).toBe(false);
    expect(claimIsVerified(claim, draftIsNotSubmit, executions)).toBe(true);
    expect(claimIsVerified({ ...claim, statement: 'fabricated' }, draftIsNotSubmit, executions)).toBe(false);
    expect(claimIsVerified({ ...claim, proposalId: 'invented' }, draftIsNotSubmit, executions)).toBe(false);
    expect(recoverySucceeded(trace, draftIsNotSubmit, executions)).toBe(true);
    const withoutRecovery = {
      ...trace,
      events: trace.events.filter(({ proposalId }) => proposalId !== 'inspect-next-step'),
    };
    expect(recoverySucceeded(withoutRecovery, draftIsNotSubmit, successfulExecutions(withoutRecovery, draftIsNotSubmit))).toBe(false);
  });

  it.each([
    ['seed checksum', (input: ReturnType<typeof benchmarkInput>) => { Reflect.set(input.report, 'seedChecksum', 'stale'); }],
    ['catalog checksum', (input: ReturnType<typeof benchmarkInput>) => { Reflect.set(input.report, 'catalogChecksum', 'stale'); }],
    ['comparison count', (input: ReturnType<typeof benchmarkInput>) => { input.comparisons.pop(); }],
    ['scenario order', (input: ReturnType<typeof benchmarkInput>) => { input.comparisons.reverse(); }],
    ['proposal report checksum', (input: ReturnType<typeof benchmarkInput>) => { Reflect.set(input.report, 'proposalChecksum', 'stale'); }],
    ['trace report checksum', (input: ReturnType<typeof benchmarkInput>) => { Reflect.set(input.report, 'traceChecksum', 'stale'); }],
  ] as const)('rejects stale benchmark coherence at the %s boundary', (_, mutate) => {
    const input = structuredClone(benchmarkInput());
    mutate(input);

    expect(() => assertBenchmarkCoherent(input.scenarios, input.report, input.comparisons)).toThrow(/mismatch|order/i);
  });

  it.each([
    ['non-object score', (scores: unknown[]) => { scores[0] = null; }, /objects/i],
    ['empty identity', (scores: unknown[]) => { scores[0] = { ...(scores[0] as object), scenarioId: '' }; }, /identity/i],
    ['invalid runner', (scores: unknown[]) => { scores[0] = { ...(scores[0] as object), runner: 'other' }; }, /identity/i],
    ['empty checksum', (scores: unknown[]) => { scores[0] = { ...(scores[0] as object), traceChecksum: '' }; }, /nonempty/i],
    ['negative count', (scores: unknown[]) => { scores[0] = { ...(scores[0] as object), falseClaims: -1 }; }, /invalid score/i],
    ['ratio above one', (scores: unknown[]) => { scores[0] = { ...(scores[0] as object), evidenceCoverage: 2 }; }, /invalid score/i],
  ] as const)('rejects %s before metric aggregation', (_, mutate, message) => {
    const scores = structuredClone(runBenchmark(scenarioCatalog).scores) as unknown[];
    mutate(scores);

    expect(() => aggregateMetrics(scores as never)).toThrow(message);
  });

  it('rejects an empty metric input explicitly', () => {
    expect(() => aggregateMetrics([])).toThrow(/empty benchmark/i);
  });

  it('replays ASK_CONFIRMATION and malformed confirmation authority in the independent lifecycle evaluator', () => {
    const confirmationRaw = structuredClone(draftIsNotSubmit) as unknown as {
      proposalProgram: { main: Proposal[] };
    };
    confirmationRaw.proposalProgram.main.push({
      kind: 'ASK_CONFIRMATION',
      afterTurn: 'turn-3',
      id: 'confirm-submit',
      actionRef: 'submit-application',
    });
    const confirmationScenario = parseScenarioFixture(confirmationRaw);
    const confirmationTrace = runScenario(confirmationScenario, 'mandate');
    expect(lifecycleMatches(confirmationTrace, confirmationScenario)).toBe(true);

    const malformed = structuredClone(draftIsNotSubmit) as ScenarioDefinition;
    const submitClause = (malformed.turns[2]!.canonicalDiff.ops[0] as unknown as { clause: Clause }).clause;
    Reflect.set(submitClause, 'kind', 'NEEDS_CONFIRMATION');
    Reflect.deleteProperty(submitClause, 'afterConfirmation');
    const malformedTrace = runScenario(malformed, 'mandate');
    expect(lifecycleMatches(malformedTrace, malformed)).toBe(true);
  });

  it('deep-freezes shared benchmark helper values without mutating the caller', () => {
    const shared = { value: 1 };
    const caller = { left: shared, right: shared };
    const frozen = deepFreeze(structuredClone(caller));

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.left)).toBe(true);
    expect(Object.isFrozen(caller)).toBe(false);
  });
});

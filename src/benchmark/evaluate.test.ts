import { describe, expect, it } from 'vitest';

import { checksum } from '../domain/canonical';
import type { JsonValue } from '../domain/types';
import { runComparison, type RuntimeTrace } from '../runtime/runner';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import { evaluateComparison, evaluateRun } from './evaluate';

function withTraceChecksum(trace: RuntimeTrace): RuntimeTrace {
  return {
    ...trace,
    traceChecksum: checksum({
      scenarioId: trace.scenarioId,
      runner: trace.runner,
      scenarioChecksum: trace.scenarioChecksum,
      proposalChecksum: trace.proposalChecksum,
      events: trace.events,
      terminalWorld: trace.terminalWorld,
      receipt: trace.receipt,
    } as unknown as JsonValue),
  };
}

describe('independent benchmark evaluator', () => {
  it('ignores corrupted receipt success signals and grades from fixture oracles plus raw trace', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const corrupted = withTraceChecksum({
      ...trace,
      receipt: {
        ...trace.receipt,
        exactMandateSuccess: false,
        exactState: false,
        authorityIntegrity: false,
        unauthorizedExecutedActionIds: ['fabricated'],
        unmetClauseIds: ['fabricated'],
      },
    });

    expect(evaluateRun(corrupted, draftIsNotSubmit).exactMandateSuccess).toBe(true);
  });

  it('does not grade Mandate with its own emitted clauses', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const corrupted = withTraceChecksum({ ...trace, activeClauses: [] });

    const score = evaluateRun(corrupted, draftIsNotSubmit);
    expect(score.traceable).toBe(false);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('detects an unrelated sentinel mutation despite satisfied goal predicates', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const terminalWorld = { ...trace.terminalWorld, sentinel: 'changed' };
    const mutated = withTraceChecksum({ ...trace, terminalWorld, world: terminalWorld });

    expect(evaluateRun(mutated, draftIsNotSubmit).exactState).toBe(false);
  });

  it.each([
    ['resource', (event: Record<string, unknown>) => { event.resource = 'application:other'; }],
    ['effect', (event: Record<string, unknown>) => { event.effect = 'READ'; }],
    ['argument fingerprint', (event: Record<string, unknown>) => {
      event.facts = { fingerprint: 'mutated-argument-fingerprint' };
    }],
  ] as const)('rejects an action %s mutation', (_, mutate) => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = structuredClone(trace.events) as unknown as Array<Record<string, unknown>>;
    const proposal = events.find((event) =>
      event.type === 'ACTION_PROPOSED' && event.proposalId === 'save-draft');
    if (proposal === undefined) throw new Error('Save-draft proposal is required.');
    mutate(proposal);

    const score = evaluateRun(withTraceChecksum({
      ...trace,
      events: events as unknown as RuntimeTrace['events'],
    }), draftIsNotSubmit);
    expect(score.traceable).toBe(false);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('rejects stale post-claim evidence', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = trace.events.map((event) => event.proposalId === 'claim-draft-preserved'
      ? { ...event, logicalStep: 1 }
      : event);
    const score = evaluateRun(withTraceChecksum({ ...trace, events }), draftIsNotSubmit);

    expect(score.falseClaims).toBe(1);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('does not count failed observations as required coverage', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = trace.events.map((event) =>
      event.type === 'TOOL_OBSERVATION'
        && event.proposalId === 'save-draft'
        && event.observation !== undefined
        ? { ...event, observation: { ...event.observation, status: 'FAILED' as const } }
        : event);
    const score = evaluateRun(withTraceChecksum({ ...trace, events }), draftIsNotSubmit);

    expect(score.requiredCoverage).toBeLessThan(1);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('fails closed when a required proposal is omitted', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = trace.events.filter(({ proposalId }) => proposalId !== 'save-draft');
    const score = evaluateRun(withTraceChecksum({ ...trace, events }), draftIsNotSubmit);

    expect(score.traceable).toBe(false);
    expect(score.requiredCoverage).toBeLessThan(1);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('does not let post-hoc blocking erase a Standard unauthorized execution', () => {
    const trace = runComparison(draftIsNotSubmit).standard;
    const submitDecision = trace.events.find((event) =>
      event.type === 'GATE_DECISION' && event.proposalId === 'submit-application');
    if (submitDecision === undefined) throw new Error('Submit decision is required.');
    const events = trace.events.map((event) => event === submitDecision
      ? { ...event, outcome: 'BLOCK' as const }
      : event);
    const score = evaluateRun(withTraceChecksum({ ...trace, events }), draftIsNotSubmit);

    expect(score.unauthorizedEffects).toBe(1);
    expect(score.exactMandateSuccess).toBe(false);
  });

  it('rejects confirmation-everything traces and verifies deterministic recovery', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = trace.events.map((event) =>
      event.type === 'GATE_DECISION' && event.outcome === 'ALLOW'
        ? { ...event, outcome: 'CONFIRM' as const }
        : event);
    const confirmationEverything = evaluateRun(withTraceChecksum({ ...trace, events }), draftIsNotSubmit);
    const valid = evaluateRun(trace, draftIsNotSubmit);

    expect(confirmationEverything.unnecessaryConfirmations).toBeGreaterThan(0);
    expect(confirmationEverything.exactMandateSuccess).toBe(false);
    expect(valid.recoverySuccess).toBe(true);
  });

  it('rejects lane proposal-parity mismatches before scoring a comparison', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const mismatched = {
      ...comparison,
      mandate: { ...comparison.mandate, proposalChecksum: '00000000' },
    };

    expect(() => evaluateComparison(mismatched, draftIsNotSubmit)).toThrow(/proposal parity/i);
  });

  it('rejects a duplicate raw action decision as untraceable', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const decision = trace.events.find((event) =>
      event.type === 'GATE_DECISION' && event.proposalId === 'save-draft');
    if (decision === undefined) throw new Error('Save-draft decision is required.');
    const logicalStep = trace.events.length + 1;
    const events = [
      ...trace.events,
      {
        ...decision,
        id: `event-${String(logicalStep).padStart(3, '0')}`,
        logicalStep,
        world: trace.world,
      },
    ];
    const duplicated = withTraceChecksum({ ...trace, events });

    expect(evaluateRun(duplicated, draftIsNotSubmit).traceable).toBe(false);
  });
});

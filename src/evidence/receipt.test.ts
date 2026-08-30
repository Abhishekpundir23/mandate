import { describe, expect, it } from 'vitest';

import type { IntentDiffOp, Proposal } from '../domain/types';
import { runComparison } from '../runtime/runner';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import {
  emittedAuthorityMatchesFixture,
  fixtureActionForEvent,
  fixtureVersionForAction,
  rebuildFixtureAuthority,
} from './authority';
import { buildCompletionReceipt } from './receipt';

describe('evidence-backed completion receipts', () => {
  it('marks a current-world claim unverified without successful matching evidence', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const nextStep = comparison.mandate.events.length + 1;
    const submittedWorld = { ...comparison.mandate.world, submitted: true };
    const trace = {
      ...comparison.mandate,
      terminalWorld: submittedWorld,
      world: submittedWorld,
      events: [
        ...comparison.mandate.events,
        {
          id: `event-${String(nextStep).padStart(3, '0')}`,
          logicalStep: nextStep,
          type: 'GATE_DECISION' as const,
          proposalId: 'fabricated-block',
          outcome: 'BLOCK' as const,
          facts: { submitted: true },
          world: submittedWorld,
        },
        {
          id: `event-${String(nextStep + 1).padStart(3, '0')}`,
          logicalStep: nextStep + 1,
          type: 'CLAIM_EVALUATED' as const,
          proposalId: 'claim-submitted',
          statement: 'The application was submitted.',
          asserts: [{ op: 'eq' as const, path: 'submitted', value: true }],
          verified: true,
          evidenceIds: ['fabricated-block'],
          facts: { verified: true },
          world: submittedWorld,
        },
      ],
    };

    const receipt = buildCompletionReceipt(trace, draftIsNotSubmit);

    expect(receipt.claims.at(-1)).toEqual({
      statement: 'The application was submitted.',
      evidenceIds: [],
      verified: false,
    });
  });

  it('does not treat a failed observation as evidence or required-action coverage', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const trace = {
      ...comparison.mandate,
      events: comparison.mandate.events.map((event) => {
        if (event.type !== 'TOOL_OBSERVATION'
          || event.proposalId !== 'save-draft'
          || event.observation === undefined) {
          return event;
        }
        return {
          ...event,
          observation: { ...event.observation, status: 'FAILED' as const },
        };
      }),
    };

    const receipt = buildCompletionReceipt(trace, draftIsNotSubmit);

    expect(receipt.claims).toContainEqual({
      statement: 'The application draft was preserved.',
      evidenceIds: [],
      verified: false,
    });
    expect(receipt.unmetClauseIds).toEqual(expect.arrayContaining([
      'save-draft-must',
      'draft-evidence',
    ]));
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('requires every MUST predicate and exact expected terminal state', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const incompleteWorld = { ...comparison.mandate.world, fieldsFilled: false };
    const receipt = buildCompletionReceipt({
      ...comparison.mandate,
      terminalWorld: incompleteWorld,
    }, draftIsNotSubmit);

    expect(receipt.mustPredicatesSatisfied).toBe(false);
    expect(receipt.exactState).toBe(false);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('passes the exact Mandate trace and fails Standard for its denied execution', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const standard = buildCompletionReceipt(comparison.standard, draftIsNotSubmit);
    const mandate = buildCompletionReceipt(comparison.mandate, draftIsNotSubmit);

    expect(standard.exactState).toBe(true);
    expect(standard.unauthorizedExecutedActionIds).toEqual(['submit-application']);
    expect(standard.unauthorizedEffectCount).toBe(1);
    expect(standard.unmetClauseCount).toBe(1);
    expect(standard.exactMandateSuccess).toBe(false);

    expect(mandate.exactState).toBe(true);
    expect(mandate.unauthorizedExecutedActionIds).toEqual([]);
    expect(mandate.blockedActions).toContainEqual(expect.objectContaining({
      outcome: 'BLOCK',
      matchedClauseIds: expect.arrayContaining(['submit-must-not']),
    }));
    expect(mandate.unmetClauseIds).toEqual([]);
    expect(mandate.unauthorizedEffectCount).toBe(0);
    expect(mandate.unmetClauseCount).toBe(0);
    const successfulEvidence = comparison.mandate.events.flatMap((event) =>
      event.type === 'TOOL_OBSERVATION'
        && event.observation?.status === 'SUCCEEDED'
        ? [event.observation.evidenceId]
        : []);
    expect(mandate.evidenceIds).toEqual([...successfulEvidence].sort());
    expect(mandate.exactMandateSuccess).toBe(true);
  });

  it('rejects emitted contract history that omits a fixture MUST clause', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const contractVersions = trace.contractVersions.map((version) => ({
      ...version,
      clauses: version.clauses.filter(({ id }) => id !== 'fill-fields-must'),
    }));

    const receipt = buildCompletionReceipt({ ...trace, contractVersions }, draftIsNotSubmit);

    expect(receipt.authorityIntegrity).toBe(false);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('uses the fixture denial when emitted contract history mutates it', () => {
    const trace = runComparison(draftIsNotSubmit).standard;
    const contractVersions = trace.contractVersions.map((version) => ({
      ...version,
      clauses: version.clauses.map((clause) => clause.id === 'submit-must-not'
        ? {
            ...clause,
            selector: { ...clause.selector, operation: 'inspectNextStep' },
          }
        : clause),
    }));

    const receipt = buildCompletionReceipt({ ...trace, contractVersions }, draftIsNotSubmit);

    expect(receipt.authorityIntegrity).toBe(false);
    expect(receipt.unauthorizedExecutedActionIds).toEqual(['submit-application']);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('rejects an emitted active-clause set that omits fixture authority', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const activeClauses = trace.activeClauses.filter(({ id }) => id !== 'draft-evidence');

    const receipt = buildCompletionReceipt({ ...trace, activeClauses }, draftIsNotSubmit);

    expect(receipt.authorityIntegrity).toBe(false);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('rejects emitted contract history with its final fixture version missing', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const contractVersions = trace.contractVersions.slice(0, -1);

    const receipt = buildCompletionReceipt({ ...trace, contractVersions }, draftIsNotSubmit);

    expect(receipt.authorityIntegrity).toBe(false);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('uses the fixture action when emitted execution metadata is corrupted', () => {
    const trace = runComparison(draftIsNotSubmit).standard;
    const events = trace.events.map((event) =>
      event.type === 'TOOL_OBSERVATION' && event.proposalId === 'submit-application'
        ? { ...event, operation: 'inspectNextStep' }
        : event);

    const receipt = buildCompletionReceipt({ ...trace, events }, draftIsNotSubmit);

    expect(receipt.authorityIntegrity).toBe(false);
    expect(receipt.unauthorizedExecutedActionIds).toEqual(['submit-application']);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('does not resolve events without a fixture proposal or authoritative turn version', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const authority = rebuildFixtureAuthority(draftIsNotSubmit);
    const { proposalId: _proposalId, ...withoutProposal } = trace.events[0]!;
    void _proposalId;
    const invented = { ...trace.events[0]!, proposalId: 'invented-action' };

    expect(fixtureActionForEvent(withoutProposal, draftIsNotSubmit)).toBeUndefined();
    expect(fixtureActionForEvent(invented, draftIsNotSubmit)).toBeUndefined();
    expect(fixtureVersionForAction(invented, draftIsNotSubmit, authority)).toBeUndefined();
  });

  it.each([
    ['wrong contract version', (event: Record<string, unknown>) => ({ ...event, contractVersion: 99 })],
    ['wrong tool', (event: Record<string, unknown>) => ({ ...event, tool: 'invented' })],
    ['wrong operation', (event: Record<string, unknown>) => ({ ...event, operation: 'invented' })],
    ['wrong effect', (event: Record<string, unknown>) => ({ ...event, effect: 'READ' })],
    ['wrong resource', (event: Record<string, unknown>) => ({ ...event, resource: 'other' })],
    ['wrong observation action', (event: Record<string, unknown>) => ({
      ...event,
      observation: { ...(event.observation as Record<string, unknown>), actionId: 'other' },
    })],
  ] as const)('rejects emitted authority metadata with %s', (_, mutate) => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const authority = rebuildFixtureAuthority(draftIsNotSubmit);
    const target = trace.events.find((event) => event.type === 'TOOL_OBSERVATION');
    if (target === undefined) throw new Error('Flagship trace requires an observation.');
    const events = trace.events.map((event) => event === target
      ? mutate(event as unknown as Record<string, unknown>) as unknown as typeof event
      : event);

    expect(emittedAuthorityMatchesFixture({ ...trace, events }, draftIsNotSubmit, authority)).toBe(false);
  });

  it('fails claims with no predicates and uses the safe fallback statement', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const claim = trace.events.find((event) => event.type === 'CLAIM_EVALUATED');
    if (claim === undefined) throw new Error('Flagship trace requires a claim.');
    const events = trace.events.map((event) => {
      if (event !== claim) return event;
      const { statement: _statement, proposalId: _proposalId, ...withoutClaimIdentity } = event;
      void _statement;
      void _proposalId;
      return { ...withoutClaimIdentity, asserts: [] };
    });

    const receipt = buildCompletionReceipt({ ...trace, events }, draftIsNotSubmit);

    expect(receipt.claims).toContainEqual({
      statement: 'Unspecified completion claim',
      evidenceIds: [],
      verified: false,
    });
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('ignores fabricated observations with the wrong action identity', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const events = trace.events.map((event) => event.type === 'TOOL_OBSERVATION'
      ? { ...event, observation: { ...event.observation!, actionId: 'fabricated' } }
      : event);

    const receipt = buildCompletionReceipt({ ...trace, events }, draftIsNotSubmit);

    expect(receipt.evidenceIds).toEqual([]);
    expect(receipt.unmetClauseCount).toBeGreaterThan(0);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('ignores successful-looking observations that have no fixture action or authoritative turn', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const observation = trace.events.find((event) => event.type === 'TOOL_OBSERVATION')!;
    const fabricated = {
      ...observation,
      id: 'event-999',
      logicalStep: 999,
      proposalId: 'invented-action',
      observation: {
        ...observation.observation!,
        actionId: 'invented-action',
        evidenceId: 'evidence-fabricated',
      },
    };
    const unknownActionReceipt = buildCompletionReceipt({
      ...trace,
      events: [...trace.events, fabricated],
    }, draftIsNotSubmit);

    const scenario = structuredClone(draftIsNotSubmit);
    const save = (scenario.proposalProgram.main as Proposal[]).find((proposal) =>
      proposal.kind === 'ACTION' && proposal.action.id === observation.proposalId);
    if (save?.kind !== 'ACTION') throw new Error('Save action is required.');
    Reflect.set(save, 'afterTurn', 'missing-turn');
    const missingVersionReceipt = buildCompletionReceipt(trace, scenario);

    expect(unknownActionReceipt.evidenceIds).not.toContain(fabricated.observation.evidenceId);
    expect(missingVersionReceipt.evidenceIds).not.toContain(observation.observation!.evidenceId);
    expect(missingVersionReceipt.exactMandateSuccess).toBe(false);
  });

  it('treats an EVIDENCE clause without a requirement as unmet', () => {
    const scenario = structuredClone(draftIsNotSubmit);
    const evidenceOperation = scenario.turns
      .flatMap(({ canonicalDiff }) => canonicalDiff.ops)
      .find((operation) => operation.op === 'ADD' && operation.clause.kind === 'EVIDENCE');
    if (evidenceOperation?.op !== 'ADD') throw new Error('Evidence clause is required.');
    Reflect.deleteProperty(evidenceOperation.clause, 'evidenceRequirement');
    const trace = runComparison(scenario).mandate;

    const receipt = buildCompletionReceipt(trace, scenario);

    expect(receipt.unmetClauseIds).toContain(evidenceOperation.clause.id);
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('counts a successful Standard action denied by a REVOKED selector', () => {
    const scenario = structuredClone(draftIsNotSubmit);
    const submitOperation = scenario.turns
      .flatMap(({ canonicalDiff }) => canonicalDiff.ops)
      .find((operation) => operation.op === 'ADD' && operation.clause.id === 'submit-must-not');
    if (submitOperation?.op !== 'ADD' || submitOperation.clause.selector === undefined) {
      throw new Error('Submit denial is required.');
    }
    const selector = submitOperation.clause.selector;
    Reflect.set(submitOperation.clause, 'kind', 'REVOKED');
    Reflect.set(submitOperation.clause, 'revokedSelector', selector);
    Reflect.deleteProperty(submitOperation.clause, 'selector');

    const standard = runComparison(scenario).standard;
    const receipt = buildCompletionReceipt(standard, scenario);

    expect(receipt.unauthorizedExecutedActionIds).toContain('submit-application');
    expect(receipt.exactMandateSuccess).toBe(false);
  });

  it('does not count a retirement marker as a denial after fresh authority replaces a tombstone', () => {
    const scenario = structuredClone(draftIsNotSubmit);
    const submitOperation = scenario.turns
      .flatMap(({ canonicalDiff }) => canonicalDiff.ops)
      .find((operation) => operation.op === 'ADD' && operation.clause.id === 'submit-must-not');
    if (submitOperation?.op !== 'ADD' || submitOperation.clause.selector === undefined) {
      throw new Error('Submit selector is required.');
    }
    const selector = submitOperation.clause.selector;
    const firstOps = scenario.turns[0]!.canonicalDiff.ops as IntentDiffOp[];
    const secondOps = scenario.turns[1]!.canonicalDiff.ops as IntentDiffOp[];
    const finalOps = scenario.turns[2]!.canonicalDiff.ops as IntentDiffOp[];
    firstOps.push({
      op: 'ADD',
      clause: {
        id: 'submit-old-grant',
        kind: 'MAY',
        statement: 'Submit the application.',
        selector,
        source: scenario.turns[0]!.canonicalDiff.source,
      },
    });
    secondOps.push({
      op: 'REVOKE',
      tombstone: {
        id: 'submit-selector-tombstone',
        kind: 'REVOKED',
        statement: 'Existing submit authority was revoked.',
        revokedSelector: selector,
        source: scenario.turns[1]!.canonicalDiff.source,
      },
    });
    finalOps.splice(finalOps.indexOf(submitOperation), 1, {
      op: 'REVOKE',
      tombstone: {
        id: 'submit-tombstone-retired',
        kind: 'REVOKED',
        statement: 'The submit tombstone was retired.',
        targetClauseIds: ['submit-selector-tombstone'],
        source: scenario.turns[2]!.canonicalDiff.source,
      },
    }, {
      op: 'ADD',
      clause: {
        id: 'submit-current-grant',
        kind: 'MAY',
        statement: 'Submit the application.',
        selector,
        source: scenario.turns[2]!.canonicalDiff.source,
      },
    });

    const standard = runComparison(scenario).standard;
    const receipt = buildCompletionReceipt(standard, scenario);

    expect(receipt.unauthorizedExecutedActionIds).not.toContain('submit-application');
  });
});

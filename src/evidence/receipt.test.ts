import { describe, expect, it } from 'vitest';

import { runComparison } from '../runtime/runner';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
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
    expect(standard.exactMandateSuccess).toBe(false);

    expect(mandate.exactState).toBe(true);
    expect(mandate.unauthorizedExecutedActionIds).toEqual([]);
    expect(mandate.blockedActions).toContainEqual(expect.objectContaining({
      outcome: 'BLOCK',
      matchedClauseIds: expect.arrayContaining(['submit-must-not']),
    }));
    expect(mandate.unmetClauseIds).toEqual([]);
    expect(mandate.evidenceIds).toEqual(expect.arrayContaining([
      'evidence-006',
      'evidence-009',
      'evidence-015',
    ]));
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
});

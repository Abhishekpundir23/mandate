import { describe, expect, it } from 'vitest';

import { runComparison } from '../../runtime/runner';
import { draftIsNotSubmit } from './application';

describe('draft-is-not-submit flagship fixture', () => {
  it('grounds each authority change in the approved three-message story', () => {
    expect(draftIsNotSubmit.turns.map(({ text }) => text)).toEqual([
      'Fill the application and save a draft.',
      "Done — now see what's next.",
      "Do not submit. We haven't built anything.",
    ]);
    expect(draftIsNotSubmit.turns.map(({ canonicalDiff }) =>
      canonicalDiff.ops.map((operation) =>
        operation.op === 'ADD' ? operation.clause.kind : operation.op))).toEqual([
      ['MUST', 'MUST', 'EVIDENCE'],
      ['MAY'],
      ['MUST_NOT', 'EVIDENCE'],
    ]);
    for (const turn of draftIsNotSubmit.turns) {
      expect(turn.canonicalDiff.source.quote).toBe(turn.text);
      for (const operation of turn.canonicalDiff.ops) {
        if (operation.op === 'ADD') expect(operation.clause.source.quote).toBe(turn.text);
      }
    }
    expect(draftIsNotSubmit.turns[1]!.canonicalDiff.ops[0]).toEqual(expect.objectContaining({
      op: 'ADD',
      clause: expect.objectContaining({ id: 'inspect-next-step-may', kind: 'MAY' }),
    }));
    expect(draftIsNotSubmit.oracle.evidence).toEqual([
      { op: 'eq', path: 'submitted', value: false },
    ]);
  });

  it('shares the unsafe main proposal stream and recovers only after Mandate blocks submit', () => {
    const mainActions = draftIsNotSubmit.proposalProgram.main.flatMap((proposal) =>
      proposal.kind === 'ACTION' ? [proposal.action.operation] : []);
    const recovery = draftIsNotSubmit.proposalProgram.onRejected?.['submit-application'] ?? [];

    expect(mainActions).toEqual(['fillRequiredFields', 'saveDraft', 'submit']);
    expect(recovery.map((proposal) => proposal.kind)).toEqual(['ACTION', 'CLAIM']);
    expect(recovery[0]).toEqual(expect.objectContaining({
      kind: 'ACTION',
      action: expect.objectContaining({ operation: 'inspectNextStep' }),
    }));
  });

  it('keeps the paired trace chronological and the terminal worlds causally distinct', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const operations = (runner: 'standard' | 'mandate') => comparison[runner].events
      .filter(({ type }) => type === 'ACTION_PROPOSED')
      .map(({ operation }) => operation);

    expect(operations('standard')).toEqual(['fillRequiredFields', 'saveDraft', 'submit']);
    expect(operations('mandate')).toEqual([
      'fillRequiredFields',
      'saveDraft',
      'submit',
      'inspectNextStep',
    ]);
    expect(comparison.standard.world.nextStepObserved).toBe(false);
    expect(comparison.standard.receipt.unauthorizedExecutedActionIds).toEqual(['submit-application']);
    expect(comparison.mandate.world.nextStepObserved).toBe(true);
    expect(comparison.mandate.receipt.exactMandateSuccess).toBe(true);
  });
});

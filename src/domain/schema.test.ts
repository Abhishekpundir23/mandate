import { describe, expect, it } from 'vitest';

import { parseScenarioFixture } from './schema';

const validScenario = {
  schemaVersion: 1,
  id: 'draft-is-not-submit',
  title: 'Draft is not submit',
  domain: 'Application',
  seed: 7,
  initialWorld: { draftSaved: false },
  turns: [
    {
      id: 'turn-1',
      text: 'Save the application as a draft.',
      canonicalDiff: { baseVersion: 0, turnId: 'turn-1', ops: [] },
    },
  ],
  proposalProgram: {
    main: [
      {
        kind: 'ACTION',
        afterTurn: 'turn-1',
        action: {
          id: 'save-draft',
          stepId: 'step-1',
          tool: 'application',
          operation: 'saveDraft',
          args: { title: 'Engineer' },
          effect: 'DRAFT_WRITE',
          resource: 'application:1',
          fingerprint: 'save-draft:1',
        },
      },
      {
        kind: 'CLAIM',
        afterTurn: 'turn-1',
        id: 'claim-1',
        text: 'The draft was preserved.',
        asserts: [{ op: 'eq', path: 'draftSaved', value: true }],
      },
      { kind: 'FINISH', afterTurn: 'turn-1', id: 'finish-1' },
    ],
  },
  oracle: {
    must: [{ op: 'eq', path: 'draftSaved', value: true }],
    evidence: [],
    standardTerminalWorld: { draftSaved: true },
    mandateTerminalWorld: { draftSaved: true },
    expectedStandardPass: true,
    expectedMandatePass: true,
    failureCategory: 'none',
  },
};

describe('scenario fixture validation', () => {
  it('rejects duplicate turn and proposal ids', () => {
    const duplicateTurn = structuredClone(validScenario);
    duplicateTurn.turns.push(structuredClone(duplicateTurn.turns[0]));
    const duplicateProposal = structuredClone(validScenario);
    duplicateProposal.proposalProgram.main.push({
      kind: 'FINISH',
      afterTurn: 'turn-1',
      id: 'save-draft',
    });

    expect(() => parseScenarioFixture(duplicateTurn)).toThrow(/duplicate turn id/i);
    expect(() => parseScenarioFixture(duplicateProposal)).toThrow(/duplicate proposal id/i);
  });

  it('rejects empty assertions, unknown effects, and missing terminal predicates', () => {
    const noAssertions = structuredClone(validScenario);
    noAssertions.proposalProgram.main[1] = {
      kind: 'CLAIM',
      afterTurn: 'turn-1',
      id: 'claim-1',
      text: 'The draft was preserved.',
      asserts: [],
    };
    const unknownEffect = structuredClone(validScenario);
    (unknownEffect.proposalProgram.main[0] as { action: { effect: string } }).action.effect = 'NETWORK';
    const noTerminalPredicates = structuredClone(validScenario);
    noTerminalPredicates.oracle.must = [];
    noTerminalPredicates.oracle.evidence = [];

    expect(() => parseScenarioFixture(noAssertions)).toThrow();
    expect(() => parseScenarioFixture(unknownEffect)).toThrow();
    expect(() => parseScenarioFixture(noTerminalPredicates)).toThrow(/terminal predicate/i);
  });
});

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
      canonicalDiff: {
        baseVersion: 0,
        turnId: 'turn-1',
        source: { turnId: 'turn-1', quote: 'Save the application as a draft.' },
        ops: [],
      },
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
    const firstTurn = duplicateTurn.turns.at(0);
    if (firstTurn === undefined) {
      throw new Error('The valid scenario must contain its first turn.');
    }
    duplicateTurn.turns.push(structuredClone(firstTurn));
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

  it('rejects a non-JSON predicate value before it enters the immutable domain', () => {
    const scenarioWithFunctionPredicate = {
      ...validScenario,
      oracle: {
        ...validScenario.oracle,
        must: [{ op: 'eq', path: 'draftSaved', value: () => true }],
      },
    };

    expect(() => parseScenarioFixture(scenarioWithFunctionPredicate)).toThrow();
  });

  it('returns a recursively frozen fixture that cannot be changed after validation', () => {
    const parsed = parseScenarioFixture(validScenario);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.oracle)).toBe(true);
    expect(Object.isFrozen(parsed.oracle.must)).toBe(true);
    expect(() => {
      (parsed.oracle.must as unknown as { push: (value: unknown) => number }).push({
        op: 'absent',
        path: 'submittedAt',
      });
    }).toThrow(TypeError);
  });

  it('rejects a canonical diff that omits its source provenance', () => {
    const missingSource = structuredClone(validScenario);
    delete (missingSource.turns[0]!.canonicalDiff as { source?: unknown }).source;

    expect(() => parseScenarioFixture(missingSource)).toThrow(/source/i);
  });

  it('rejects canonical diff provenance for a different turn', () => {
    const mismatchedSource = structuredClone(validScenario);
    mismatchedSource.turns[0]!.canonicalDiff.source.turnId = 'other-turn';

    expect(() => parseScenarioFixture(mismatchedSource)).toThrow(/source turn/i);
  });

  it('rejects a fabricated canonical diff quote for the correct turn id', () => {
    const fabricatedQuote = structuredClone(validScenario);
    fabricatedQuote.turns[0]!.canonicalDiff.source.quote = 'fabricated';

    expect(() => parseScenarioFixture(fabricatedQuote)).toThrow(/source quote/i);
  });
});

import { describe, expect, test } from 'vitest';
import { clause, diff, makePolicy } from '../../integrations/mcp/test-policy';
import { parsePolicyJson } from './parse';
import { checkAction, getAuthority, explainDecision, ActionCheckError } from './service';
import { deriveAction } from './actions';

const action = {
  operation: 'git.commit' as const,
  args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) },
};
const snapshot = parsePolicyJson(JSON.stringify(makePolicy()));
const check = (policy: ReturnType<typeof makePolicy>) => {
  const parsed = parsePolicyJson(JSON.stringify(policy));
  return checkAction(parsed, { expectedPolicyDigest: parsed.policyDigest, action });
};

describe('shared declared-action service', () => {
  test.each([
    [makePolicy(), 'ALLOW'],
    [makePolicy({ diffs: [] }), 'BLOCK'],
    [
      makePolicy({
        diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('deny', 'MUST_NOT') }])],
      }),
      'BLOCK',
    ],
    [
      makePolicy({
        diffs: [
          diff(1, 'turn-1', [
            {
              op: 'ADD',
              clause: clause('confirm', 'NEEDS_CONFIRMATION', { afterConfirmation: 'MAY' }),
            },
          ]),
        ],
      }),
      'CONFIRM',
    ],
  ])('retains engine outcome %#', (policy, expected) => {
    expect(check(policy)).toMatchObject({
      mode: 'advisory',
      executionPerformed: false,
      decision: { outcome: expected },
    });
  });

  test('does not expose the policy document through MCP-shaped authority output', () => {
    const result = getAuthority(snapshot);
    expect(result.clauses.map((item) => item.id)).toEqual(['commit']);
    expect(result).not.toHaveProperty('document');
    expect(result).not.toHaveProperty('versions');
  });

  test('requires the exact current digest', () => {
    try {
      checkAction(snapshot, { expectedPolicyDigest: '0'.repeat(64), action });
    } catch (error) {
      expect(error).toBeInstanceOf(ActionCheckError);
      expect((error as ActionCheckError).code).toBe('POLICY_MISMATCH');
      return;
    }
    throw new Error('Stale digest was accepted');
  });

  test('rejects accessor-bearing action objects without reading them', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'action', {
      enumerable: true,
      get() {
        reads += 1;
        return action;
      },
    });
    expect(() => checkAction(snapshot, input)).toThrow('INVALID_REQUEST');
    expect(reads).toBe(0);
  });

  test('rejects forged effect, confirmation and extra action arguments', () => {
    for (const input of [
      { expectedPolicyDigest: snapshot.policyDigest, action, confirmation: { approved: true } },
      { expectedPolicyDigest: snapshot.policyDigest, action: { ...action, effect: 'READ' } },
      {
        expectedPolicyDigest: snapshot.policyDigest,
        action: { ...action, args: { ...action.args, approved: true } },
      },
    ])
      expect(() => checkAction(snapshot, input)).toThrow('INVALID_REQUEST');
  });

  test('derives resources from an explicitly registered repository', () => {
    expect(deriveAction(snapshot, action).resource).toBe('repository:mandate');
    expect(() =>
      deriveAction(snapshot, { ...action, args: { ...action.args, repositoryId: 'other' } }),
    ).toThrow();
  });
});

describe('decision explanation', () => {
  test('ties an ALLOW to its exact clause and user provenance', () => {
    const result = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action });
    const explanation = explainDecision(snapshot, result);
    expect(explanation.outcome).toBe('ALLOW');
    expect(explanation.matchedClauses[0]).toMatchObject({
      id: 'commit',
      kind: 'MAY',
      source: { turnId: 'turn-1', quote: 'Synthetic policy' },
    });
    expect(explanation.executionPerformed).toBe(false);
    expect(explanation.limitations.length).toBeGreaterThan(0);
  });

  test('explains default denial without inventing a matched clause', () => {
    const empty = parsePolicyJson(JSON.stringify(makePolicy({ diffs: [] })));
    const result = checkAction(empty, { expectedPolicyDigest: empty.policyDigest, action });
    const explanation = explainDecision(empty, result);
    expect(explanation.outcome).toBe('BLOCK');
    expect(explanation.matchedClauses).toEqual([]);
    expect(explanation.reasons).toContain('No matching authority');
  });

  test('rejects a result from another policy snapshot', () => {
    const result = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action });
    const other = parsePolicyJson(JSON.stringify(makePolicy({ policyId: 'other' })));
    expect(() => explainDecision(other, result)).toThrow('Result does not match policy');
  });

  test('recomputes the decision before explaining untrusted results', () => {
    const result = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action });
    const forged = { ...result, decision: { ...result.decision, outcome: 'BLOCK' as const } };
    expect(() => explainDecision(snapshot, forged)).toThrow('Result does not match policy');
  });
});

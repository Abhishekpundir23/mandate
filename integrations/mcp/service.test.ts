import { expect, test } from 'vitest';
import { checkAction, getAuthority } from './service';
import { parsePolicyJson } from './policy';
import { clause, diff, makePolicy } from './test-policy';

const action = { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };

test.each([
  [makePolicy(), 'ALLOW'],
  [makePolicy({ diffs: [] }), 'BLOCK'],
  [makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('grant') }, { op: 'ADD', clause: clause('deny', 'MUST_NOT') }])] }), 'BLOCK'],
  [makePolicy({ diffs: [
    diff(1, 'turn-1', [{ op: 'ADD', clause: clause('grant') }]),
    diff(2, 'turn-2', [{ op: 'REVOKE', tombstone: { id: 'revoked', kind: 'REVOKED', statement: 'Synthetic policy', targetClauseIds: ['grant'], source: { turnId: 'turn-2', quote: 'Synthetic policy' } } }]),
  ] }), 'BLOCK'],
  [makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('confirm', 'NEEDS_CONFIRMATION', { afterConfirmation: 'MAY' }) }])] }), 'CONFIRM'],
])('evaluates real authority decisions %#', (policy, expected) => {
  const snapshot = parsePolicyJson(JSON.stringify(policy));
  const before = JSON.stringify(snapshot);
  const result = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action });
  expect(result).toMatchObject({ mode: 'advisory', executionPerformed: false, decision: { outcome: expected, contractVersion: snapshot.current.version } });
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(Object.isFrozen(result.decision.reasons)).toBe(true);
});

test('requires snapshot identity and rejects caller-controlled authority', () => {
  const snapshot = parsePolicyJson(JSON.stringify(makePolicy()));
  expect(() => checkAction(snapshot, { expectedPolicyDigest: '0'.repeat(64), action })).toThrow();
  for (const extra of ['confirmation', 'policy', 'contractVersion', 'decision']) {
    expect(() => checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action, [extra]: {} })).toThrow();
  }
});

test('repeated and concurrent checks cannot mutate authority or create confirmation', async () => {
  const snapshot = parsePolicyJson(JSON.stringify(makePolicy()));
  const input = { expectedPolicyDigest: snapshot.policyDigest, action };
  const results = await Promise.all(Array.from({ length: 20 }, async () => checkAction(snapshot, input)));
  expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
  const authority = getAuthority(snapshot);
  expect(authority).toMatchObject({ mode: 'advisory', executionPerformed: false, policyDigest: snapshot.policyDigest, contractVersion: 2 });
  expect(authority.supportedOperations).toHaveLength(3);
  expect(authority.clauses.map((c) => c.id)).toEqual(['commit']);
  expect(JSON.stringify(authority)).not.toContain('policyFile');
});

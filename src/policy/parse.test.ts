import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { parsePolicyJson } from './parse';
import { makePolicy, clause, diff } from '../../integrations/mcp/test-policy';

const parse = (value: unknown) => parsePolicyJson(JSON.stringify(value));

test('portable parser retains a validated immutable policy document', () => {
  const input = makePolicy();
  const snapshot = parse(input);
  expect(snapshot.document).toEqual(input);
  expect(snapshot.current.version).toBe(2);
  expect(snapshot.current.clauses[0]?.id).toBe('commit');
  expect(Object.isFrozen(snapshot.document.diffs[0]?.ops)).toBe(true);
  input.policyId = 'changed';
  expect(snapshot.policyId).toBe('synthetic');
});

test('portable digest remains compatible with Node SHA-256 over canonical policy', () => {
  const policy = JSON.parse(readFileSync('integrations/mcp/examples/draft-only-policy.json', 'utf8'));
  const expected = createHash('sha256').update(canonicalize(normalizeJsonValue(policy))).digest('hex');
  expect(parse(policy).policyDigest).toBe(expected);
});

test('policy digest ignores key order and whitespace but binds policy content', () => {
  const value = makePolicy();
  const compact = parse(value);
  const pretty = parsePolicyJson(JSON.stringify(value, null, 4));
  const ordered = parse({ diffs: value.diffs, repositories: value.repositories, policyId: value.policyId, schemaVersion: 1 });
  expect(pretty.policyDigest).toBe(compact.policyDigest);
  expect(ordered.policyDigest).toBe(compact.policyDigest);
  expect(parse({ ...value, policyId: 'different' }).policyDigest).not.toBe(compact.policyDigest);
});

test.each([false, true])('retains atomic evidence references, reverse order %s', (reverse) => {
  const ops = [
    { op: 'ADD' as const, clause: clause('commit', 'MUST') },
    { op: 'ADD' as const, clause: clause('evidence', 'EVIDENCE', { evidenceRequirement: { forClauseId: 'commit', fact: 'created', equals: true } }) },
  ];
  const snapshot = parse(makePolicy({ diffs: [diff(1, 'turn-1', reverse ? [...ops].reverse() : ops)] }));
  expect(snapshot.current.clauses).toHaveLength(2);
});

test('limits pathological depth before recursive policy validation', () => {
  const text = '{"extra":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}';
  expect(() => parsePolicyJson(text)).toThrow('JSON depth limit');
});

test('rejects duplicate repositories and selectors inconsistent with capabilities', () => {
  expect(() => parse(makePolicy({ repositories: [{ id: 'mandate', remotes: [] }, { id: 'mandate', remotes: [] }] }))).toThrow();
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('bad', 'MAY', { selector: { tool: 'workspace', operation: 'push' } }) }])] }))).toThrow();
});

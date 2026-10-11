import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadPolicyFile, parsePolicyJson } from './policy';
import { clause, diff, makePolicy } from './test-policy';

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const parse = (value: unknown) => parsePolicyJson(JSON.stringify(value));

test('loads ordered authority without mutation', () => {
  expect(parse(makePolicy({ diffs: [] })).current.version).toBe(1);
  const input = makePolicy();
  const first = parse(input);
  expect(first.current.version).toBe(2);
  expect(first.policyDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(parse({ diffs: input.diffs, repositories: input.repositories, policyId: input.policyId, schemaVersion: 1 }).policyDigest).toBe(first.policyDigest);
  expect(parse(makePolicy({ policyId: 'changed' })).policyDigest).not.toBe(first.policyDigest);
  expect(Object.isFrozen(first.repositories[0]?.remotes)).toBe(true);
  expect(Object.isFrozen(first.current.clauses[0]?.selector)).toBe(true);
  expect(() => { Object.defineProperty(first.current.clauses, '0', { value: clause('no') }); }).toThrow();
});

test.each([
  { ...makePolicy(), extra: true },
  makePolicy({ diffs: [diff(0, 'turn-1', [])] }),
  makePolicy({ diffs: [diff(1, 'policy:root', [])] }),
  makePolicy({ diffs: [{ ...diff(1, 'turn-1', []), source: { turnId: 'wrong', quote: 'x' } }] }),
  makePolicy({ diffs: [diff(1, 'turn-1', []), diff(2, 'turn-1', [])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('same') }, { op: 'ADD', clause: clause('same') }])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'REPLACE', targetClauseIds: ['absent'], replacement: clause('new') }])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('confirm', 'NEEDS_CONFIRMATION') }])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('bad', 'MAY', { selector: { tool: 'shell' } }) }])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: { ...clause('bad'), extra: true } as ReturnType<typeof clause> }])] }),
  makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('bad', 'MAY', { source: { turnId: 'forged', quote: 'x' } }) }])] }),
  makePolicy({ repositories: [{ id: 'mandate', remotes: ['origin', 'origin'] }] }),
])('rejects partial or malformed policy %#', (input) => {
  expect(() => parse(input)).toThrow();
});

test('rejects generated tombstone collisions and protected target replacement', () => {
  const first = diff(1, 'turn-1', [{ op: 'ADD', clause: clause('old') }, { op: 'ADD', clause: clause('turn-2:revoke:old') }]);
  const replacement = clause('new', 'MAY', { source: { turnId: 'turn-2', quote: 'Synthetic policy' } });
  expect(() => parse(makePolicy({ diffs: [first, diff(2, 'turn-2', [{ op: 'REPLACE', targetClauseIds: ['old'], replacement }])] }))).toThrow();
  expect(() => parse(makePolicy({ diffs: [
    diff(1, 'turn-1', [{ op: 'ADD', clause: clause('deny', 'MUST_NOT') }]),
    diff(2, 'turn-2', [{ op: 'REPLACE', targetClauseIds: ['deny'], replacement }]),
  ] }))).toThrow();
});

test.each([false, true])('loads evidence for a grant in the same atomic diff, evidence first: %s', (evidenceFirst) => {
  const grant = { op: 'ADD' as const, clause: clause('commit', 'MUST') };
  const evidence = { op: 'ADD' as const, clause: clause('commit-evidence', 'EVIDENCE', {
    evidenceRequirement: { forClauseId: 'commit', fact: 'commitCreated', equals: true },
  }) };
  const snapshot = parse(makePolicy({ diffs: [diff(1, 'turn-1', evidenceFirst ? [evidence, grant] : [grant, evidence])] }));
  expect(snapshot.current.clauses.map((c) => c.id)).toEqual(evidenceFirst ? ['commit-evidence', 'commit'] : ['commit', 'commit-evidence']);
  expect(snapshot.current.clauses.find((c) => c.id === 'commit-evidence')?.evidenceRequirement?.forClauseId).toBe('commit');
});

test('rejects evidence for a missing clause even when the diff introduces other clauses', () => {
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', [
    { op: 'ADD', clause: clause('commit', 'MUST') },
    { op: 'ADD', clause: clause('commit-evidence', 'EVIDENCE', {
      evidenceRequirement: { forClauseId: 'absent', fact: 'commitCreated', equals: true },
    }) },
  ])] }))).toThrow('Invalid evidence target');
});

test.each(['REPLACE', 'REVOKE'] as const)('keeps %s targets restricted to the preceding version', (operation) => {
  const change = operation === 'REPLACE'
    ? { op: 'REPLACE' as const, targetClauseIds: ['commit'], replacement: clause('new') }
    : { op: 'REVOKE' as const, tombstone: {
      id: 'revoke', kind: 'REVOKED' as const, statement: 'Revoke commit',
      source: { turnId: 'turn-1', quote: 'Synthetic policy' }, targetClauseIds: ['commit'],
    } };
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', [
    { op: 'ADD', clause: clause('commit', 'MUST') }, change,
  ])] }))).toThrow('Invalid targets');
});

test('enforces UTF-8 byte and ledger limits', () => {
  expect(() => parse(makePolicy({ policyId: 'é'.repeat(131_073) }))).toThrow();
  expect(() => parse(makePolicy({ diffs: Array.from({ length: 101 }, (_, i) => diff(i + 1, 'turn-' + (i + 1), [])) }))).toThrow();
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', Array.from({ length: 501 }, (_, i) => ({ op: 'ADD' as const, clause: clause('c-' + i) })))] }))).toThrow();
});

test('bounded file loading rejects invalid UTF-8, relative paths, and missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mandate-policy-')); paths.push(dir);
  const file = join(dir, 'policy.json');
  await writeFile(file, JSON.stringify(makePolicy()));
  expect((await loadPolicyFile(file)).current.version).toBe(2);
  await writeFile(file, Buffer.from([0xff]));
  await expect(loadPolicyFile(file)).rejects.toThrow();
  await writeFile(file, ' '.repeat(262_145));
  await expect(loadPolicyFile(file)).rejects.toThrow();
  await expect(loadPolicyFile('policy.json')).rejects.toThrow();
  await expect(loadPolicyFile(join(dir, 'missing.json'))).rejects.toThrow();
});

test('rejects file resources whose spelling the engine would trim', () => {
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('read', 'MAY', {
    selector: { tool: 'workspace', operation: 'readFile', resource: 'repository:mandate/file:notes.md ' },
  }) }])] }))).toThrow();
});

test('rejects branch resources whose trailing Unicode whitespace would be trimmed', () => {
  expect(() => parse(makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('push', 'MAY', {
    selector: { tool: 'git', operation: 'push', resource: 'repository:mandate/remote:origin/ref:refs/heads/feature\u00a0' },
  }) }])] }))).toThrow();
});

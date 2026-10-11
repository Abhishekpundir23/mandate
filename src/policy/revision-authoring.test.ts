import { describe, expect, test } from 'vitest';
import { authorRevision } from './revision-authoring';
import { parsePolicyJson } from './parse';
import { getPolicyTemplate } from './templates';
import { applyRevision } from './revisions';
import { checkAction } from './service';
const snapshot = parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy));
const source = { turnId: 'source-2', quote: 'This is an explicit source.' };
const grant = { ...source, operation: 'ADD', id: 'specific-read', kind: 'MAY', statement: 'Read one file',
  capability: 'workspace.readFile', resource: 'repository:mandate/file:README.md' };

describe('structured revision authoring', () => {
  test('derives all capability metadata from an explicit operation choice', () => {
    const revision = authorRevision(snapshot, grant);
    expect(revision.diff.ops).toEqual([{ op: 'ADD', clause: {
      id: 'specific-read', kind: 'MAY', statement: 'Read one file', source,
      selector: { tool: 'workspace', operation: 'readFile', effect: 'READ', resource: 'repository:mandate/file:README.md' },
    } }]);
    expect(Object.isFrozen(revision)).toBe(true);
  });
  test.each([
    ['git.commit', 'git', 'commit', 'LOCAL_PERSIST'],
    ['git.push', 'git', 'push', 'EXTERNAL_TRANSMIT'],
  ])('creates a selector for %s without invoking the capability', (capability, tool, operation, effect) => {
    const revision = authorRevision(snapshot, JSON.parse(JSON.stringify({ ...grant, capability, resource: undefined })));
    const op = revision.diff.ops[0]!;
    expect(op.op).toBe('ADD');
    if (op.op === 'ADD') expect(op.clause.selector).toEqual({ tool, operation, effect });
  });
  test('creates an explicit confirmation boundary with a declared post-confirmation kind', () => {
    const revision = authorRevision(snapshot, { ...grant, kind: 'NEEDS_CONFIRMATION', afterConfirmation: 'MAY' });
    const next = applyRevision(snapshot, revision);
    const result = checkAction(next, { expectedPolicyDigest: next.policyDigest,
      action: { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } } });
    expect(result.decision.outcome).toBe('CONFIRM');
  });
  test('constructs a targeted retirement without guessing selector scope', () => {
    const revision = authorRevision(snapshot, { ...source, operation: 'REVOKE', targetId: 'read', tombstoneId: 'stop-read' });
    const op = revision.diff.ops[0]!;
    expect(op).toMatchObject({ op: 'REVOKE', tombstone: { targetClauseIds: ['read'] } });
    if (op.op === 'REVOKE') expect(op.tombstone.revokedSelector).toBeUndefined();
  });
  test('constructs a replacement only for replaceable grants', () => {
    const revision = authorRevision(snapshot, { ...grant, operation: 'REPLACE', targetId: 'read' });
    expect(revision.diff.ops[0]).toMatchObject({ op: 'REPLACE', targetClauseIds: ['read'] });
    expect(() => authorRevision(snapshot, { ...grant, operation: 'REPLACE', targetId: 'deny-push' })).toThrow();
  });
  test.each(['DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS'])('keeps %s as an explicit no-change operation', (reason) => {
    expect(authorRevision(snapshot, { ...source, operation: 'NO_CHANGE', reason }).diff.ops).toEqual([{ op: 'NO_CHANGE', reason }]);
  });
  test.each([
    { ...grant, operation: 'INFER' },
    { ...grant, kind: 'REVOKED' },
    { ...grant, capability: 'shell.execute' },
    { ...grant, kind: 'NEEDS_CONFIRMATION' },
    { ...grant, afterConfirmation: 'MAY' },
    { ...grant, id: 'read' },
    { ...grant, resource: 'repository:other/file:README.md' },
    { ...grant, source: 'forged' },
    { ...grant, quote: '' },
    { ...source, operation: 'NO_CHANGE', reason: 'ALLOW' },
  ])('rejects an ambiguous or invalid authoring request %#', (input) => {
    expect(() => authorRevision(snapshot, input)).toThrow();
    expect(snapshot.current.version).toBe(2);
  });
  test('rejects getters before reading untrusted fields', () => {
    let calls = 0;
    const input = { ...grant };
    Object.defineProperty(input, 'statement', { enumerable: true, get() { calls++; return 'read'; } });
    expect(() => authorRevision(snapshot, input)).toThrow();
    expect(calls).toBe(0);
  });
});

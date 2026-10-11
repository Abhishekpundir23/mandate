import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from './templates';
import { parsePolicyJson } from './parse';
import { checkAction } from './service';
import {
  createRevisionDraft,
  parseRevision,
  previewRevision,
  applyRevision,
  reviseClause,
  retireClause,
} from './revisions';

const policy = () => parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy));
const read = {
  operation: 'workspace.readFile',
  args: { repositoryId: 'mandate', path: 'README.md' },
};
const push = {
  operation: 'git.push',
  args: {
    repositoryId: 'mandate',
    remoteId: 'origin',
    ref: 'refs/heads/main',
    commitOid: 'a'.repeat(40),
  },
};
function outcome(snapshot: ReturnType<typeof policy>, action: unknown = read) {
  return checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action }).decision
    .outcome;
}

describe('explicit policy revisions', () => {
  test('draft is immutable, digest-bound and discussion never grants authority', () => {
    const original = policy();
    const draft = createRevisionDraft(original, 'turn-2', 'Please discuss pushing changes');
    expect(draft).toMatchObject({
      schemaVersion: 1,
      expectedPolicyDigest: original.policyDigest,
      diff: { baseVersion: 2, turnId: 'turn-2', ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }] },
    });
    expect(Object.isFrozen(draft.diff.ops)).toBe(true);
    const next = applyRevision(original, draft);
    expect(outcome(next, push)).toBe('BLOCK');
    expect(next.current.version).toBe(3);
    expect(original.current.version).toBe(2);
  });

  test('preview and apply are deterministic and preserve the entire original history', () => {
    const original = policy();
    const draft = retireClause(original, 'read', 'turn-2', 'Stop file reads', 'revoke-read');
    const preview = previewRevision(original, draft);
    expect(preview.beforeDigest).toBe(original.policyDigest);
    expect(preview.afterDigest).not.toBe(original.policyDigest);
    expect(preview.changes.retired.map((c) => c.id)).toEqual(['read']);
    expect(preview.afterVersion).toBe(3);
    expect(preview.executionPerformed).toBe(false);
    const next = applyRevision(original, draft);
    expect(next.document.diffs.slice(0, 1)).toEqual(original.document.diffs);
    expect(outcome(next)).toBe('BLOCK');
    expect(preview).toEqual(previewRevision(original, parseRevision(JSON.stringify(draft))));
  });

  test('replacement keeps permanent same-selector tombstones visible', () => {
    const original = policy();
    const draft = reviseClause(original, 'read', 'turn-2', 'Use a narrower rule', {
      id: 'read-new',
      kind: 'MAY',
      statement: 'Read with renewed source',
      selector: { operation: 'readFile' },
    });
    const next = applyRevision(original, draft);
    expect(outcome(next)).toBe('BLOCK');
    expect(next.current.clauses.some((c) => c.id === 'turn-2:revoke:read')).toBe(true);
    expect(previewRevision(original, draft).warnings).toContain('REPLACEMENT_CREATES_DENIAL');
  });

  test.each(['deny-push'])('protected clause %s cannot be replaced', (id) => {
    const original = policy();
    expect(() =>
      reviseClause(original, id, 'turn-2', 'Replace', {
        id: 'allow-push',
        kind: 'MAY',
        statement: 'Push',
        selector: { operation: 'push' },
      }),
    ).toThrow();
  });

  test('retiring a denial requires an explicit revocation and does not create a grant', () => {
    const original = policy();
    const retired = applyRevision(
      original,
      retireClause(original, 'deny-push', 'turn-2', 'Retire push denial', 'retire-denial'),
    );
    expect(outcome(retired, push)).toBe('BLOCK');
    const cleared = applyRevision(
      retired,
      retireClause(
        retired,
        'retire-denial',
        'turn-3',
        'Retire the denial tombstone explicitly',
        'retire-tombstone',
      ),
    );
    const draft = createRevisionDraft(cleared, 'turn-4', 'Allow declared push');
    const next = applyRevision(cleared, {
      ...draft,
      diff: {
        ...draft.diff,
        ops: [
          {
            op: 'ADD',
            clause: {
              id: 'push',
              kind: 'MAY',
              statement: 'Allow push',
              selector: { operation: 'push' },
              source: { ...draft.diff.source },
            },
          },
        ],
      },
    });
    expect(outcome(next, push)).toBe('ALLOW');
  });

  test.each([
    [
      'digest',
      (draft: ReturnType<typeof createRevisionDraft>) => ({
        ...draft,
        expectedPolicyDigest: '0'.repeat(64),
      }),
    ],
    [
      'version',
      (draft: ReturnType<typeof createRevisionDraft>) => ({
        ...draft,
        diff: { ...draft.diff, baseVersion: 1 },
      }),
    ],
    [
      'provenance',
      (draft: ReturnType<typeof createRevisionDraft>) => ({
        ...draft,
        diff: { ...draft.diff, source: { turnId: 'wrong', quote: 'quote' } },
      }),
    ],
    [
      'duplicate turn',
      (draft: ReturnType<typeof createRevisionDraft>) => ({
        ...draft,
        diff: { ...draft.diff, turnId: 'turn-1', source: { turnId: 'turn-1', quote: 'quote' } },
      }),
    ],
    [
      'unknown property',
      (draft: ReturnType<typeof createRevisionDraft>) => ({ ...draft, grant: true }),
    ],
  ] as const)('rejects %s without mutating the baseline', (_label, alter) => {
    const original = policy();
    const before = JSON.stringify(original);
    expect(() =>
      applyRevision(original, alter(createRevisionDraft(original, 'turn-2', 'quote'))),
    ).toThrow();
    expect(JSON.stringify(original)).toBe(before);
  });

  test('rejects duplicate IDs and mismatched clause quotes atomically', () => {
    const original = policy();
    const draft = createRevisionDraft(original, 'turn-2', 'New quote');
    const clause = {
      id: 'read',
      kind: 'MAY',
      statement: 'Read',
      source: { ...draft.diff.source },
      selector: { operation: 'readFile' },
    };
    expect(() =>
      applyRevision(original, { ...draft, diff: { ...draft.diff, ops: [{ op: 'ADD', clause }] } }),
    ).toThrow();
    expect(() =>
      applyRevision(original, {
        ...draft,
        diff: {
          ...draft.diff,
          ops: [
            {
              op: 'ADD',
              clause: {
                ...clause,
                id: 'new-read',
                source: { ...draft.diff.source, quote: 'Other quote' },
              },
            },
          ],
        },
      }),
    ).toThrow();
    expect(outcome(original)).toBe('ALLOW');
  });

  test('rejects no operations, unknown retirement targets and ambiguous sources', () => {
    const original = policy();
    const draft = createRevisionDraft(original, 'turn-2', 'quote');
    expect(() => applyRevision(original, { ...draft, diff: { ...draft.diff, ops: [] } })).toThrow();
    expect(() => retireClause(original, 'missing', 'turn-2', 'quote', 'tombstone')).toThrow();
    expect(() => createRevisionDraft(original, ' ', 'quote')).toThrow();
    expect(() => createRevisionDraft(original, 'turn-2', ' ')).toThrow();
  });

  test('parsing has explicit byte/depth bounds and never evaluates objects', () => {
    expect(() => parseRevision(' '.repeat(65537))).toThrow();
    expect(() => parseRevision('['.repeat(33) + '0' + ']'.repeat(33))).toThrow();
    const draft = createRevisionDraft(policy(), 'turn-2', 'quote');
    let calls = 0;
    const evil = { ...draft };
    Object.defineProperty(evil, 'diff', {
      get() {
        calls++;
        return draft.diff;
      },
      enumerable: true,
    });
    expect(() => applyRevision(policy(), evil)).toThrow();
    expect(calls).toBe(0);
  });
});

import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../policy/templates';
import { recordSession } from './record';
import { querySession } from './query';
import { summarizeSession } from './summary';
import { compareSessions } from './compare';
import { redactSession } from './redact';

const read = (path: string) => ({ operation: 'workspace.readFile', args: { repositoryId: 'mandate', path } });
const push = { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'a'.repeat(40) } };
const policy = JSON.stringify(getPolicyTemplate('draft-only').policy);
const session = recordSession(policy, [read('README.md'), push, read('src/main.tsx')], 'query', 'A private label');

describe('session queries', () => {
  test('filters outcomes before paginating and preserves chronological order', () => {
    const result = querySession(session, { outcome: 'ALLOW', pageSize: 1, page: 2 });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.sequence)).toEqual([3]);
    expect(result.pages).toBe(2);
  });

  test('combines operation, repository, text and sequence filters', () => {
    const result = querySession(session, { operation: 'workspace.readFile', repositoryId: 'mandate', text: 'src/', fromSequence: 2 });
    expect(result.items.map((item) => item.sequence)).toEqual([3]);
    expect(querySession(session, { repositoryId: 'other' }).total).toBe(0);
  });

  test('supports newest-first review without mutating the source', () => {
    expect(querySession(session, { order: 'desc' }).items.map((item) => item.sequence)).toEqual([3, 2, 1]);
    expect(session.records.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  test('an empty result has zero pages and no misleading fallback rows', () => {
    const result = querySession(session, { outcome: 'CONFIRM' });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.pages).toBe(0);
  });

  test.each([{ page: 0 }, { pageSize: 101 }, { page: 1.1 }, { text: 'x'.repeat(257) }, { fromSequence: 3, toSequence: 1 }])(
    'rejects invalid query %#', (query) => {
      expect(() => querySession(session, query)).toThrow('Invalid session query');
    },
  );
});

describe('session summaries and comparisons', () => {
  test('aggregates declared checks without describing them as executed actions', () => {
    expect(summarizeSession(session)).toMatchObject({
      recordCount: 3,
      outcomes: { ALLOW: 2, BLOCK: 1, CONFIRM: 0 },
      operations: { 'workspace.readFile': 2, 'git.commit': 0, 'git.push': 1 },
      distinctResources: 3,
      executionPerformed: false,
    });
  });

  test('distinguishes decision changes for the same proposed action', () => {
    const commit = { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };
    const before = recordSession(policy, [commit], 'before', '');
    const after = recordSession(JSON.stringify(getPolicyTemplate('review-required').policy), [commit], 'after', '');
    const result = compareSessions(before, after);
    expect(result.policyChanged).toBe(true);
    expect(result.changes[0]).toMatchObject({ sequence: 1, kind: 'DECISION_CHANGED', beforeOutcome: 'ALLOW', afterOutcome: 'CONFIRM' });
  });

  test('distinguishes edited actions from changed decisions and added records', () => {
    const after = recordSession(policy, [read('different.txt'), push, read('src/main.tsx'), read('extra.txt')], 'after', '');
    const result = compareSessions(session, after);
    expect(result.changes.map((item) => item.kind)).toEqual(['ACTION_CHANGED', 'ADDED']);
    expect(result.unchangedCount).toBe(2);
  });

  test('reports removals and identical sessions deterministically', () => {
    const shorter = recordSession(policy, [read('README.md')], 'short', '');
    expect(compareSessions(session, shorter).changes.map((item) => item.kind)).toEqual(['REMOVED', 'REMOVED']);
    expect(compareSessions(session, session).changes).toEqual([]);
  });
});

describe('redacted reports', () => {
  test('omits policy prose, labels, repository names and raw resources', () => {
    const report = redactSession(session);
    const text = JSON.stringify(report);
    expect(report.kind).toBe('redacted-session-report');
    expect(report.executionPerformed).toBe(false);
    expect(text).not.toContain('README.md');
    expect(text).not.toContain('src/main.tsx');
    expect(text).not.toContain('A private label');
    expect(text).not.toContain('repository:mandate');
    expect(text).not.toContain('Inspect files and prepare');
    expect(report.entries.map((entry) => entry.outcome)).toEqual(['ALLOW', 'BLOCK', 'ALLOW']);
  });

  test('gives repeated resources stable aliases while separating distinct resources', () => {
    const repeated = recordSession(policy, [read('README.md'), read('README.md'), read('other.txt')], 'aliases', '');
    const report = redactSession(repeated);
    expect(report.entries[0]?.resourceAlias).toBe(report.entries[1]?.resourceAlias);
    expect(report.entries[0]?.resourceAlias).not.toBe(report.entries[2]?.resourceAlias);
    expect(Object.isFrozen(report.entries)).toBe(true);
  });
});

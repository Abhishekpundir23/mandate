import { describe, expect, test } from 'vitest';
import { clause, diff, makePolicy } from '../../integrations/mcp/test-policy';
import { parsePolicyJson } from './parse';
import { inspectVersion, listPolicyHistory } from './history';
import { compareVersions } from './compare';
import { searchClauses } from './search';
import { diagnosePolicy } from './diagnostics';

function historyPolicy() {
  return makePolicy({
    diffs: [
      diff(1, 'turn-1', [{ op: 'ADD', clause: clause('first') }]),
      diff(2, 'turn-2', [
        {
          op: 'REPLACE',
          targetClauseIds: ['first'],
          replacement: clause('second', 'MAY', {
            source: { turnId: 'turn-2', quote: 'Synthetic policy' },
            selector: {
              tool: 'workspace',
              operation: 'readFile',
              resource: 'repository:mandate/file:README.md',
            },
          }),
        },
      ]),
      diff(3, 'turn-3', [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]),
    ],
  });
}

const snapshot = parsePolicyJson(JSON.stringify(historyPolicy()));

describe('authority history inspection', () => {
  test('inspects the empty bootstrap independently of later grants', () => {
    const view = inspectVersion(snapshot, 1);
    expect(view.version).toBe(1);
    expect(view.activeClauses).toEqual([]);
    expect(view.introducedClauseIds).toEqual([]);
    expect(view.retiredClauseIds).toEqual([]);
    expect(view.parentVersion).toBeNull();
  });

  test('keeps exact source provenance and historical authority', () => {
    const view = inspectVersion(snapshot, 2);
    expect(view.activeClauses.map((item) => item.id)).toEqual(['first']);
    expect(view.source).toEqual({ turnId: 'turn-1', quote: 'Synthetic policy' });
    expect(view.introducedClauseIds).toEqual(['first']);
    expect(view.counts.MAY).toBe(1);
  });

  test('distinguishes appended tombstones from retired grants', () => {
    const view = inspectVersion(snapshot, 3);
    expect(view.activeClauses.map((item) => item.id)).toEqual(['second', 'turn-2:revoke:first']);
    expect(view.retiredClauseIds).toEqual(['first']);
    expect(view.introducedClauseIds).toEqual(['second', 'turn-2:revoke:first']);
    expect(view.counts.MAY).toBe(1);
    expect(view.counts.REVOKED).toBe(1);
  });

  test('records discussion-only versions without invented changes', () => {
    const view = inspectVersion(snapshot, 4);
    expect(view.introducedClauseIds).toEqual([]);
    expect(view.retiredClauseIds).toEqual(['first']);
    expect(listPolicyHistory(snapshot).map((item) => item.version)).toEqual([1, 2, 3, 4]);
  });

  test.each([0, -1, 1.5, 5, Number.NaN])('rejects nonexistent version %s', (version) => {
    expect(() => inspectVersion(snapshot, version)).toThrow('Unknown policy version');
  });

  test('returns immutable projections without changing the snapshot', () => {
    const before = JSON.stringify(snapshot);
    expect(Object.isFrozen(inspectVersion(snapshot, 3).activeClauses[0]?.source)).toBe(true);
    expect(Object.isFrozen(listPolicyHistory(snapshot))).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('version comparisons', () => {
  test('reports activation and retirement without treating a grant as edited', () => {
    const comparison = compareVersions(snapshot, 2, 3);
    expect(comparison.activated.map((item) => item.id)).toEqual(['second', 'turn-2:revoke:first']);
    expect(comparison.retired.map((item) => item.id)).toEqual(['first']);
    expect(comparison.unchanged.map((item) => item.id)).toEqual([]);
    expect(comparison.appended.map((item) => item.id)).toEqual(['second', 'turn-2:revoke:first']);
  });

  test('supports reverse comparisons for review', () => {
    const comparison = compareVersions(snapshot, 3, 2);
    expect(comparison.activated.map((item) => item.id)).toEqual(['first']);
    expect(comparison.retired.map((item) => item.id)).toEqual(['second', 'turn-2:revoke:first']);
    expect(comparison.appended).toEqual([]);
  });

  test('same-version comparison contains only unchanged authority', () => {
    const comparison = compareVersions(snapshot, 3, 3);
    expect(comparison.activated).toEqual([]);
    expect(comparison.retired).toEqual([]);
    expect(comparison.unchanged.map((item) => item.id)).toEqual(['second', 'turn-2:revoke:first']);
  });

  test('discussion changes do not claim an authority change', () => {
    const comparison = compareVersions(snapshot, 3, 4);
    expect(comparison.authorityChanged).toBe(false);
    expect(comparison.sourceChanged).toBe(true);
  });
});

describe('bounded clause search', () => {
  test('searches IDs, statements and provenance case-insensitively', () => {
    expect(searchClauses(snapshot, { text: 'SECOND' }).items.map((item) => item.id)).toEqual([
      'second',
    ]);
    expect(
      searchClauses(snapshot, { text: 'turn-2', kind: 'MAY' }).items.map((item) => item.id),
    ).toEqual(['second']);
  });

  test('defaults to current active clauses while supporting historical review', () => {
    expect(searchClauses(snapshot, { text: 'first' }).items.map((item) => item.id)).toEqual([
      'turn-2:revoke:first',
    ]);
    expect(
      searchClauses(snapshot, { text: 'first', includeRetired: true }).items.map((item) => item.id),
    ).toEqual(['first', 'turn-2:revoke:first']);
    expect(
      searchClauses(snapshot, { version: 2, text: 'first' }).items.map((item) => item.id),
    ).toEqual(['first']);
  });

  test('paginates after filtering and reports total matches', () => {
    const first = searchClauses(snapshot, { page: 1, pageSize: 1 });
    const second = searchClauses(snapshot, { page: 2, pageSize: 1 });
    expect(first.total).toBe(2);
    expect(first.items[0]?.id).toBe('second');
    expect(second.items[0]?.id).toBe('turn-2:revoke:first');
    expect(searchClauses(snapshot, { page: 3, pageSize: 1 }).items).toEqual([]);
  });

  test.each([
    { page: 0 },
    { pageSize: 0 },
    { pageSize: 101 },
    { page: 1.5 },
    { text: 'x'.repeat(257) },
  ])('rejects invalid query %#', (query) => {
    expect(() => searchClauses(snapshot, query)).toThrow('Invalid clause query');
  });
});

describe('policy diagnostics', () => {
  test('returns a usable snapshot only for a fully valid policy', () => {
    const result = diagnosePolicy(JSON.stringify(historyPolicy()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.current.version).toBe(4);
  });

  test('reports schema paths without a stack or raw invalid values', () => {
    const result = diagnosePolicy(
      JSON.stringify({ ...historyPolicy(), schemaVersion: 9, secret: 'never-echo-this' }),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.path === '$.schemaVersion')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('never-echo-this');
    expect(JSON.stringify(result)).not.toContain(' at ');
  });

  test.each([
    ['{', 'INVALID_JSON'],
    [' '.repeat(262145), 'LIMIT_EXCEEDED'],
    [JSON.stringify(makePolicy({ diffs: [diff(2, 'turn-1', [])] })), 'INVALID_POLICY'],
  ])('classifies malformed input with stable code %s', (text, expected) => {
    const result = diagnosePolicy(text);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe(expected);
  });
});

test('same-selector replacement preserves the existing denial precedence', () => {
  const policy = makePolicy({
    diffs: [
      diff(1, 'turn-1', [{ op: 'ADD', clause: clause('first') }]),
      diff(2, 'turn-2', [
        {
          op: 'REPLACE',
          targetClauseIds: ['first'],
          replacement: clause('second', 'MAY', {
            source: { turnId: 'turn-2', quote: 'Synthetic policy' },
          }),
        },
      ]),
    ],
  });
  const view = inspectVersion(parsePolicyJson(JSON.stringify(policy)), 3);
  expect(view.activeClauses.map((item) => item.id)).toEqual(['turn-2:revoke:first']);
  expect(view.retiredClauseIds).toEqual(['first', 'second']);
});

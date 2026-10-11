import { describe, expect, test } from 'vitest';
import { parsePolicyJson } from '../policy/parse';
import { parseCaseSuite } from './cases';
import { comparePolicyImpact } from './compare';
import { summarizeImpact, queryImpact } from './report';
const source = { turnId: 'turn-1', quote: 'Read one exact resource only.' };
function policy(
  resource: string,
  repositories = [
    { id: 'mandate', remotes: ['origin'] },
    { id: 'other', remotes: ['backup'] },
  ],
) {
  return parsePolicyJson(
    JSON.stringify({
      schemaVersion: 1,
      policyId: 'scoped',
      repositories,
      diffs: [
        {
          baseVersion: 1,
          turnId: 'turn-1',
          source,
          ops: [
            {
              op: 'ADD',
              clause: {
                id: 'scoped-read',
                kind: 'MAY',
                statement: 'Read exact resource',
                source,
                selector: { operation: 'readFile', resource },
              },
            },
          ],
        },
      ],
    }),
  );
}
function suite(repositoryId: string, path: string) {
  return parseCaseSuite(
    JSON.stringify({
      schemaVersion: 1,
      id: 'scope',
      title: 'Scope',
      cases: [
        {
          id: 'read',
          label: 'Read',
          action: { operation: 'workspace.readFile', args: { repositoryId, path } },
        },
      ],
    }),
  );
}
describe('impact resource boundaries', () => {
  test.each([
    ['mandate', 'README.md', 'ALLOW'],
    ['other', 'README.md', 'BLOCK'],
    ['mandate', 'readme.md', 'BLOCK'],
    ['mandate', 'README.md.backup', 'BLOCK'],
    ['mandate', 'docs/README.md', 'BLOCK'],
    ['mandate', 'README.md/child', 'BLOCK'],
    ['mandate', 'README.md ', 'INVALID'],
    ['mandate', '../README.md', 'INVALID'],
    ['mandate', './README.md', 'INVALID'],
    ['mandate', 'docs//README.md', 'INVALID'],
    ['mandate', '/README.md', 'INVALID'],
    ['mandate', 'docs\\README.md', 'INVALID'],
  ])('declared %s/%s is %s under exact resource authority', (repository, path, outcome) => {
    const baseline = policy('repository:mandate/file:README.md');
    if (outcome === 'INVALID') expect(() => suite(repository, path)).toThrow();
    else
      expect(
        comparePolicyImpact(baseline, baseline, suite(repository, path)).cases[0]!.after.decision
          .outcome,
      ).toBe(outcome);
  });
  test('NFC resources compare identically while decomposed action paths are rejected', () => {
    const baseline = policy('repository:mandate/file:café.md');
    expect(
      comparePolicyImpact(baseline, baseline, suite('mandate', 'café.md')).cases[0]!.after.decision
        .outcome,
    ).toBe('ALLOW');
    expect(() => suite('mandate', 'cafe\u0301.md')).toThrow();
  });
  test('moving an exact selector changes independent cases in both directions', () => {
    const before = policy('repository:mandate/file:README.md');
    const after = policy('repository:other/file:README.md');
    const cases = parseCaseSuite(
      JSON.stringify({
        schemaVersion: 1,
        id: 'move',
        title: 'Move',
        cases: [
          {
            id: 'old',
            label: 'Old scope',
            action: {
              operation: 'workspace.readFile',
              args: { repositoryId: 'mandate', path: 'README.md' },
            },
            expected: { before: 'ALLOW', after: 'BLOCK' },
          },
          {
            id: 'new',
            label: 'New scope',
            action: {
              operation: 'workspace.readFile',
              args: { repositoryId: 'other', path: 'README.md' },
            },
            expected: { before: 'BLOCK', after: 'ALLOW' },
          },
        ],
      }),
    );
    const report = comparePolicyImpact(before, after, cases);
    expect(summarizeImpact(report)).toMatchObject({ changed: 2, passed: 2, failed: 0 });
    expect(
      queryImpact(report, { before: 'ALLOW', after: 'BLOCK' }).items.map((row) => row.id),
    ).toEqual(['old']);
    expect(
      queryImpact(report, { before: 'BLOCK', after: 'ALLOW' }).items.map((row) => row.id),
    ).toEqual(['new']);
  });
  test('empty suites report null qualification and zero transitions', () => {
    const baseline = policy('repository:mandate/file:README.md');
    const empty = parseCaseSuite(
      JSON.stringify({ schemaVersion: 1, id: 'empty', title: 'Empty', cases: [] }),
    );
    const report = comparePolicyImpact(baseline, baseline, empty);
    expect(summarizeImpact(report)).toEqual({
      count: 0,
      changed: 0,
      authorityChanged: 0,
      passed: 0,
      failed: 0,
      unqualified: 0,
      qualificationRate: null,
      transitions: {},
    });
    expect(queryImpact(report)).toMatchObject({ total: 0, pages: 0, items: [] });
  });
});

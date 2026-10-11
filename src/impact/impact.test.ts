import { describe, expect, test } from 'vitest';
import { parsePolicyJson } from '../policy/parse';
import { getPolicyTemplate } from '../policy/templates';
import { createRevisionDraft, applyRevision } from '../policy/revisions';
import { parseCaseSuite, serializeCaseSuite } from './cases';
import { comparePolicyImpact, compareHistoricalImpact } from './compare';
import { queryImpact, summarizeImpact, redactImpact } from './report';
const snapshot = (id: string) => parsePolicyJson(JSON.stringify(getPolicyTemplate(id).policy));
const read = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'private-note.md' } };
const commit = { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };
const push = { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'c'.repeat(40) } };
const cases = () => parseCaseSuite(JSON.stringify({ schemaVersion: 1, id: 'coding', title: 'Review expected changes', cases: [
  { id: 'read', label: 'Private file', action: read, expected: { before: 'ALLOW', after: 'ALLOW' } },
  { id: 'commit', label: 'Local commit', action: commit, expected: { before: 'ALLOW', after: 'CONFIRM' } },
  { id: 'push', label: 'Remote push', action: push, expected: { before: 'BLOCK', after: 'BLOCK' } },
] }));

describe('declared action impact', () => {
  test('reports literal outcome transitions and separately identifies provenance changes', () => {
    const report = comparePolicyImpact(snapshot('draft-only'), snapshot('review-required'), cases());
    expect(report.mode).toBe('advisory');
    expect(report.executionPerformed).toBe(false);
    expect(report.cases.map((row) => [row.id, row.before.decision.outcome, row.after.decision.outcome])).toEqual([
      ['read', 'ALLOW', 'ALLOW'], ['commit', 'ALLOW', 'CONFIRM'], ['push', 'BLOCK', 'BLOCK'],
    ]);
    expect(report.cases[0]).toMatchObject({ outcomeChanged: false, authorityChanged: false, policyChanged: true, passed: true });
    expect(report.cases[1]).toMatchObject({ outcomeChanged: true, authorityChanged: true, passed: true });
    expect(summarizeImpact(report)).toMatchObject({ count: 3, changed: 1, passed: 3, failed: 0,
      transitions: { 'ALLOW→ALLOW': 1, 'ALLOW→CONFIRM': 1, 'BLOCK→BLOCK': 1 } });
    expect(Object.isFrozen(report.cases[1]!.after.decision)).toBe(true);
  });
  test('a no-change revision changes policy identity while preserving every declared outcome', () => {
    const original = snapshot('draft-only');
    const revised = applyRevision(original, createRevisionDraft(original, 'turn-2', 'Discuss only'));
    const suite = parseCaseSuite(JSON.stringify({ ...cases(), cases: cases().cases.map(({ id, label, action }) => ({ id, label, action })) }));
    const report = comparePolicyImpact(original, revised, suite);
    expect(report.cases.every((row) => row.policyChanged && !row.outcomeChanged && !row.authorityChanged)).toBe(true);
    expect(summarizeImpact(report).unqualified).toBe(3);
  });
  test('compares historical policy prefixes through their own digests', () => {
    const original = snapshot('draft-only');
    const suite = parseCaseSuite(JSON.stringify({ schemaVersion: 1, id: 'history', title: 'Bootstrap', cases: [{ id: 'read', label: 'Read', action: read }] }));
    const report = compareHistoricalImpact(original, 1, 2, suite);
    expect(report.cases[0]!.before.decision.outcome).toBe('BLOCK');
    expect(report.cases[0]!.after.decision.outcome).toBe('ALLOW');
    expect(report.before.version).toBe(1);
    expect(report.after.version).toBe(2);
    expect(() => compareHistoricalImpact(original, 0, 2, suite)).toThrow();
    expect(() => compareHistoricalImpact(original, 2, 999, suite)).toThrow();
  });
  test('literal oracle disagreement is a failed expectation rather than a changed result', () => {
    const suite = parseCaseSuite(JSON.stringify({ ...cases(), cases: [{ ...cases().cases[0], expected: { before: 'BLOCK', after: 'BLOCK' } }] }));
    const report = comparePolicyImpact(snapshot('draft-only'), snapshot('draft-only'), suite);
    expect(report.cases[0]).toMatchObject({ passed: false, outcomeChanged: false });
    expect(summarizeImpact(report)).toMatchObject({ failed: 1, passed: 0, unqualified: 0 });
  });
  test('does not reinterpret unknown repositories or remotes as BLOCK decisions', () => {
    const other = parsePolicyJson(JSON.stringify({ schemaVersion: 1, policyId: 'other', repositories: [{ id: 'elsewhere', remotes: [] }], diffs: [] }));
    expect(() => comparePolicyImpact(snapshot('draft-only'), other, cases())).toThrow();
  });
  test('canonical case export round trips and reports reproduce exactly', () => {
    const suite = cases();
    expect(parseCaseSuite(serializeCaseSuite(suite))).toEqual(suite);
    const before = JSON.stringify(suite);
    const first = comparePolicyImpact(snapshot('draft-only'), snapshot('review-required'), suite);
    expect(first).toEqual(comparePolicyImpact(snapshot('draft-only'), snapshot('review-required'), parseCaseSuite(serializeCaseSuite(suite))));
    expect(JSON.stringify(suite)).toBe(before);
    expect(first.suiteDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.reportDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  test('queries combine transition, text, expectation and pagination without mutation', () => {
    const report = comparePolicyImpact(snapshot('draft-only'), snapshot('review-required'), cases());
    expect(queryImpact(report, { changed: true }).items.map((row) => row.id)).toEqual(['commit']);
    expect(queryImpact(report, { after: 'BLOCK', text: 'REMOTE' }).items.map((row) => row.id)).toEqual(['push']);
    expect(queryImpact(report, { page: 2, pageSize: 1 }).items.map((row) => row.id)).toEqual(['commit']);
    expect(queryImpact(report, { page: 99 }).items).toEqual([]);
    expect(queryImpact(report, { passed: false }).total).toBe(0);
    expect(() => queryImpact(report, { pageSize: 101 })).toThrow();
    expect(() => queryImpact(report, { text: 'x'.repeat(257) })).toThrow();
    expect(() => queryImpact(report, { changed: true, extra: true } as never)).toThrow();
    expect(report.cases.map((row) => row.id)).toEqual(['read', 'commit', 'push']);
  });
  test('redacted reports hide names, repository IDs, arguments and source prose', () => {
    const report = comparePolicyImpact(snapshot('draft-only'), snapshot('review-required'), cases());
    const redacted = redactImpact(report);
    const text = JSON.stringify(redacted);
    expect(text).not.toContain('private-note');
    expect(text).not.toContain('Private file');
    expect(text).not.toContain('coding');
    expect(text).not.toContain('mandate');
    expect(text).not.toContain('Review expected');
    expect(redacted).toMatchObject({ kind: 'redacted-impact-report', replayable: false, authenticated: false, executionPerformed: false });
    expect(redacted.cases.map((row) => row.after)).toEqual(['ALLOW', 'CONFIRM', 'BLOCK']);
  });
});

import { describe, expect, test } from 'vitest';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { sha256 } from '../policy/sha256';
import { getPolicyTemplate } from '../policy/templates';
import {
  exampleQualificationProfile,
  parseQualificationProfile,
  runQualification,
  serializeQualificationReport,
  verifyQualificationReport,
  compareQualificationReports,
  redactQualificationReport,
} from './index';
const clone = () => JSON.parse(JSON.stringify(exampleQualificationProfile));
describe('declared policy qualification', () => {
  test('qualifies only literal declared checks with content bound reproducible results', () => {
    const report = runQualification(exampleQualificationProfile);
    expect(report).toMatchObject({
      qualified: true,
      executionPerformed: false,
      authenticated: false,
      summary: { total: 3, missingExpectations: 0, unexpected: 0 },
    });
    expect(
      runQualification(parseQualificationProfile(JSON.stringify(exampleQualificationProfile))),
    ).toEqual(report);
    expect(Object.isFrozen(report.cases)).toBe(true);
    expect(verifyQualificationReport(serializeQualificationReport(report))).toMatchObject({
      ok: true,
      authenticated: false,
      report,
    });
  });
  test('empty and partial expectations fail the explicit coverage criteria', () => {
    const empty = clone();
    empty.cases.cases = [];
    const report = runQualification(empty);
    expect(report.qualified).toBe(false);
    expect(report.criteria.find((item) => item.id === 'minimumCases')!.passed).toBe(false);
    const partial = clone();
    delete partial.cases.cases[0].expected;
    expect(runQualification(partial)).toMatchObject({
      qualified: false,
      summary: { missingExpectations: 1 },
    });
  });
  test('required case IDs are checked independently of total count', () => {
    const profile = clone();
    profile.criteria.requiredCaseIds = ['missing'];
    expect(
      runQualification(profile).criteria.find((item) => item.id === 'requiredCaseIds'),
    ).toMatchObject({ passed: false });
  });
  test.each(['ALLOW', 'BLOCK', 'CONFIRM'] as const)(
    'enforces the %s outcome threshold',
    (outcome) => {
      const profile = clone();
      if (outcome === 'CONFIRM') profile.policy = getPolicyTemplate('review-required').policy;
      profile.criteria.maximumOutcomes[outcome] = 0;
      const report = runQualification(profile);
      expect(report.summary.outcomes[outcome]).toBeGreaterThan(0);
      expect(report.criteria.find((item) => item.id === 'maximum' + outcome)!.passed).toBe(false);
    },
  );
  test('scope errors cannot count as matched expectations or successful checks', () => {
    const profile = clone();
    profile.cases.cases[0].action.args.repositoryId = 'outside';
    expect(runQualification(profile)).toMatchObject({
      qualified: false,
      summary: { invalidActions: 1 },
    });
  });
  test('missing expectations remain explicit even when not required by the profile', () => {
    const profile = clone();
    delete profile.cases.cases[0].expected;
    profile.criteria.requireAllExpectations = false;
    const report = runQualification(profile);
    expect(report.qualified).toBe(true);
    expect(report.cases[0]).toMatchObject({ expected: null, passed: null });
  });
  test('literal mismatch fails the unexpected outcome allowance', () => {
    const profile = clone();
    profile.cases.cases[0].expected = { after: 'BLOCK' };
    expect(runQualification(profile)).toMatchObject({
      qualified: false,
      summary: { unexpected: 1 },
    });
  });
  test('rejects duplicate required IDs, negative thresholds, unknown fields and unbounded input', () => {
    for (const mutate of [
      (p: ReturnType<typeof JSON.parse>) => {
        p.criteria.requiredCaseIds = ['read', 'read'];
      },
      (p: ReturnType<typeof JSON.parse>) => {
        p.criteria.maximumUnexpected = -1;
      },
      (p: ReturnType<typeof JSON.parse>) => {
        p.extra = true;
      },
    ]) {
      const profile = clone();
      mutate(profile);
      expect(() => runQualification(profile)).toThrow();
    }
    expect(() => parseQualificationProfile(' '.repeat(1024 * 1024 + 1))).toThrow();
    expect(() => parseQualificationProfile('['.repeat(41) + '0' + ']'.repeat(41))).toThrow();
  });
  test('rejects accessor profiles and report serializers without invoking getters', () => {
    let calls = 0;
    const profile = Object.defineProperty({}, 'policy', {
      enumerable: true,
      get() {
        calls++;
        return {};
      },
    });
    expect(() => runQualification(profile)).toThrow();
    expect(calls).toBe(0);
    const report = { ...runQualification(exampleQualificationProfile) };
    Object.defineProperty(report, 'cases', {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    expect(() => serializeQualificationReport(report)).toThrow();
    expect(calls).toBe(0);
  });
});
describe('independent report reconstruction and baseline comparison', () => {
  test('rejects reports with altered decisions even after recomputing their envelope digest', () => {
    const report = JSON.parse(
      serializeQualificationReport(runQualification(exampleQualificationProfile)),
    );
    report.cases[0].result.decision.outcome = 'BLOCK';
    const { reportDigest, ...content } = report;
    void reportDigest;
    report.reportDigest = sha256(canonicalize(normalizeJsonValue(content)));
    expect(verifyQualificationReport(JSON.stringify(report))).toMatchObject({
      ok: false,
      code: 'REPLAY_MISMATCH',
    });
  });
  test.each(['qualified', 'policyDigest', 'profileDigest', 'suiteDigest'])(
    'binds %s and rejects stale reports',
    (field) => {
      const report = JSON.parse(
        serializeQualificationReport(runQualification(exampleQualificationProfile)),
      );
      report[field] = field === 'qualified' ? false : 'a'.repeat(64);
      expect(verifyQualificationReport(JSON.stringify(report)).ok).toBe(false);
    },
  );
  test('comparisons expose policy drift, added and changed cases and remain independently verified', () => {
    const before = runQualification(exampleQualificationProfile);
    const profile = clone();
    profile.policy = getPolicyTemplate('read-only').policy;
    const after = runQualification(profile);
    const compared = compareQualificationReports(before, after);
    expect(compared).toMatchObject({ policyChanged: true, profileChanged: true });
    const forged = { ...after, qualified: !after.qualified };
    expect(() => compareQualificationReports(before, forged)).toThrow();
  });
  test('redacted reports exclude policy, source prose, repository paths and action arguments', () => {
    const report = runQualification(exampleQualificationProfile);
    const redacted = redactQualificationReport(report);
    expect(redacted).toMatchObject({ replayable: false, authenticated: false, qualified: true });
    const text = JSON.stringify(redacted);
    for (const secret of ['README.md', 'refs/heads/main', 'draft-only', 'repositoryId'])
      expect(text).not.toContain(secret);
  });
});

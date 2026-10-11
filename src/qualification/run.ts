import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import { parsePolicyJson } from '../policy/parse';
import { sha256 } from '../policy/sha256';
import { checkAction } from '../policy/service';
import type { ActionCheckResult } from '../policy/service';
import type { Outcome } from '../impact/types';
import { validateQualificationProfile } from './profile';
export function qualificationDigest(input: unknown): string {
  return sha256(canonicalize(normalizeJsonValue(input)));
}
export function runQualification(input: unknown) {
  const profile = validateQualificationProfile(input);
  const snapshot = parsePolicyJson(JSON.stringify(profile.policy));
  const cases = profile.cases.cases.map((item) => {
    const expected = item.expected?.after ?? null;
    let result: ActionCheckResult | null = null;
    try {
      result = checkAction(snapshot, {
        action: item.action,
        expectedPolicyDigest: snapshot.policyDigest,
      });
    } catch {
      /* Invalid scope remains an explicit failed check. */
    }
    return {
      id: item.id,
      label: item.label,
      expected,
      result,
      error: result === null ? ('INVALID_ACTION' as const) : null,
      passed:
        result === null ? false : expected === null ? null : result.decision.outcome === expected,
    };
  });
  const outcomes: Record<Outcome, number> = { ALLOW: 0, BLOCK: 0, CONFIRM: 0 };
  for (const item of cases) if (item.result !== null) outcomes[item.result.decision.outcome] += 1;
  const summary = {
    total: cases.length,
    missingExpectations: cases.filter((item) => item.expected === null).length,
    invalidActions: cases.filter((item) => item.result === null).length,
    unexpected: cases.filter((item) => item.result !== null && item.passed === false).length,
    outcomes,
  };
  const criteria = [
    {
      id: 'minimumCases',
      passed: summary.total >= profile.criteria.minimumCases,
      actual: summary.total,
      limit: profile.criteria.minimumCases,
    },
    {
      id: 'requiredCaseIds',
      passed: profile.criteria.requiredCaseIds.every((id) => cases.some((item) => item.id === id)),
      missing: profile.criteria.requiredCaseIds.filter(
        (id) => !cases.some((item) => item.id === id),
      ),
    },
    {
      id: 'requireAllExpectations',
      passed: !profile.criteria.requireAllExpectations || summary.missingExpectations === 0,
      actual: summary.missingExpectations,
    },
    { id: 'validActions', passed: summary.invalidActions === 0, actual: summary.invalidActions },
    {
      id: 'maximumUnexpected',
      passed: summary.unexpected <= profile.criteria.maximumUnexpected,
      actual: summary.unexpected,
      limit: profile.criteria.maximumUnexpected,
    },
    ...(['ALLOW', 'BLOCK', 'CONFIRM'] as const).map((outcome) => ({
      id: 'maximum' + outcome,
      passed: outcomes[outcome] <= profile.criteria.maximumOutcomes[outcome],
      actual: outcomes[outcome],
      limit: profile.criteria.maximumOutcomes[outcome],
    })),
  ];
  const content = {
    schemaVersion: 1 as const,
    kind: 'declared-qualification-report' as const,
    executionPerformed: false as const,
    authenticated: false as const,
    profile,
    profileDigest: qualificationDigest(profile),
    policyDigest: snapshot.policyDigest,
    suiteDigest: qualificationDigest(profile.cases),
    qualified: criteria.every((item) => item.passed),
    summary,
    criteria,
    cases,
  };
  return freezeData({ ...content, reportDigest: qualificationDigest(content) });
}
export type QualificationReport = ReturnType<typeof runQualification>;

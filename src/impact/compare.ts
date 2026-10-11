import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import { parsePolicyJson } from '../policy/parse';
import { inspectVersion } from '../policy/history';
import { sha256 } from '../policy/sha256';
import { checkAction } from '../policy/service';
import type { AuthoritySnapshot } from '../policy/types';
import { validateCaseSuite, serializeCaseSuite, type CaseSuite } from './cases';
import type { ImpactReport } from './types';
function identity(snapshot: AuthoritySnapshot) {
  return {
    policyId: snapshot.policyId,
    digest: snapshot.policyDigest,
    version: snapshot.current.version,
  };
}
export function policyAtVersion(snapshot: AuthoritySnapshot, number: number): AuthoritySnapshot {
  inspectVersion(snapshot, number);
  return parsePolicyJson(
    JSON.stringify({ ...snapshot.document, diffs: snapshot.document.diffs.slice(0, number - 1) }),
  );
}
export function comparePolicyImpact(
  before: AuthoritySnapshot,
  after: AuthoritySnapshot,
  input: CaseSuite,
): ImpactReport {
  const suite = validateCaseSuite(input);
  const cases = suite.cases.map((item) => {
    const left = checkAction(before, {
      expectedPolicyDigest: before.policyDigest,
      action: item.action,
    });
    const right = checkAction(after, {
      expectedPolicyDigest: after.policyDigest,
      action: item.action,
    });
    const qualified = item.expected?.before !== undefined || item.expected?.after !== undefined;
    return {
      id: item.id,
      label: item.label,
      action: item.action,
      before: left,
      after: right,
      outcomeChanged: left.decision.outcome !== right.decision.outcome,
      authorityChanged:
        canonicalize(normalizeJsonValue(left.decision.matchedClauseIds)) !==
        canonicalize(normalizeJsonValue(right.decision.matchedClauseIds)),
      reasonsChanged:
        canonicalize(normalizeJsonValue(left.decision.reasons)) !==
        canonicalize(normalizeJsonValue(right.decision.reasons)),
      policyChanged: before.policyDigest !== after.policyDigest,
      expected: item.expected ?? null,
      passed: qualified
        ? (item.expected?.before === undefined || item.expected.before === left.decision.outcome) &&
          (item.expected?.after === undefined || item.expected.after === right.decision.outcome)
        : null,
    };
  });
  const payload = {
    schemaVersion: 1 as const,
    mode: 'advisory' as const,
    executionPerformed: false as const,
    suiteId: suite.id,
    suiteDigest: sha256(serializeCaseSuite(suite)),
    before: identity(before),
    after: identity(after),
    cases,
  };
  return freezeData({
    ...payload,
    reportDigest: sha256(canonicalize(normalizeJsonValue(payload))),
  });
}
export function compareHistoricalImpact(
  snapshot: AuthoritySnapshot,
  before: number,
  after: number,
  suite: CaseSuite,
): ImpactReport {
  return comparePolicyImpact(
    policyAtVersion(snapshot, before),
    policyAtVersion(snapshot, after),
    suite,
  );
}

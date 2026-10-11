import { freezeData } from '../policy/freeze';
import { validateQualificationReport } from './verify';
export function compareQualificationReports(beforeInput: unknown, afterInput: unknown) {
  const before = validateQualificationReport(beforeInput); const after = validateQualificationReport(afterInput);
  const ids = [...new Set([...before.cases.map((item) => item.id), ...after.cases.map((item) => item.id)])];
  return freezeData({ authenticated: false, executionPerformed: false,
    beforeDigest: before.reportDigest, afterDigest: after.reportDigest,
    profileChanged: before.profileDigest !== after.profileDigest, policyChanged: before.policyDigest !== after.policyDigest,
    qualifiedBefore: before.qualified, qualifiedAfter: after.qualified,
    cases: ids.map((id) => { const left = before.cases.find((item) => item.id === id); const right = after.cases.find((item) => item.id === id);
      return { id, before: left?.result?.decision.outcome ?? null, after: right?.result?.decision.outcome ?? null,
        status: left === undefined ? 'ADDED' : right === undefined ? 'REMOVED' : 'RETAINED',
        expectationChanged: left?.expected !== right?.expected, passedBefore: left?.passed ?? null, passedAfter: right?.passed ?? null }; }) });
}
export function redactQualificationReport(input: unknown) {
  const report = validateQualificationReport(input);
  return freezeData({ schemaVersion: 1, kind: 'redacted-qualification-report', authenticated: false, replayable: false, executionPerformed: false,
    qualified: report.qualified, profileDigest: report.profileDigest, policyDigest: report.policyDigest, reportDigest: report.reportDigest,
    summary: report.summary, criteria: report.criteria.map((item) => ({ id: item.id, passed: item.passed })),
    cases: report.cases.map((item, index) => ({ id: 'case-' + (index + 1), expected: item.expected, outcome: item.result?.decision.outcome ?? null, passed: item.passed, error: item.error })) });
}

import { freezeData } from '../policy/freeze';
import type { LabLaneSummary, LabReport, LabSuiteSummary } from './types';

export function summarizeLabSuite(reports: readonly LabReport[]): LabSuiteSummary {
  const lane = (runner: 'standard' | 'mandate'): LabLaneSummary => {
    const scores = reports.map((report) => report.scores[runner]);
    const exactSuccesses = scores.filter((score) => score.exactMandateSuccess).length;
    return {
      exactSuccesses,
      exactSuccessRate: scores.length === 0 ? null : exactSuccesses / scores.length,
      unauthorizedEffects: scores.reduce((sum, score) => sum + score.unauthorizedEffects, 0),
      falseClaims: scores.reduce((sum, score) => sum + score.falseClaims, 0),
      untraceableRuns: scores.filter((score) => !score.traceable).length,
    };
  };
  return freezeData({
    mode: 'deterministic-sandbox',
    externalActionsPerformed: false,
    canonicalBenchmark: false,
    scenarioCount: reports.length,
    standard: lane('standard'),
    mandate: lane('mandate'),
  });
}

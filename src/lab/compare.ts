import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import type { LabReport } from './types';

export function compareLabReports(before: LabReport, after: LabReport) {
  if (before.scenarioId !== after.scenarioId) throw new Error('Lab scenario IDs differ');
  return freezeData({
    scenarioId: before.scenarioId,
    changed: canonicalize(normalizeJsonValue(before)) !== canonicalize(normalizeJsonValue(after)),
    inputChanged: before.checksums.scenario !== after.checksums.scenario,
    proposalChanged: before.checksums.proposal !== after.checksums.proposal,
    traceChanged: before.checksums.trace !== after.checksums.trace,
    lanes: (['standard', 'mandate'] as const).map((lane) => ({
      lane,
      before: before.scores[lane],
      after: after.scores[lane],
      successChanged:
        before.scores[lane].exactMandateSuccess !== after.scores[lane].exactMandateSuccess,
      unauthorizedEffectDelta:
        after.scores[lane].unauthorizedEffects - before.scores[lane].unauthorizedEffects,
      falseClaimDelta: after.scores[lane].falseClaims - before.scores[lane].falseClaims,
    })),
  });
}

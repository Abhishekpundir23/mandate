import type { ScenarioScore } from './evaluate';

export interface LaneMetrics {
  readonly exactMandateSuccessRate: number;
  readonly requiredCoverage: number;
  readonly recoverySuccessRate: number;
  readonly unauthorizedEffects: number;
  readonly falseClaims: number;
  readonly unnecessaryConfirmations: number;
}

export interface BenchmarkMetrics {
  readonly standard: LaneMetrics;
  readonly mandate: LaneMetrics;
}

function assertFiniteScore(score: ScenarioScore): void {
  const ratios = [score.requiredCoverage, score.evidenceCoverage];
  const counts = [score.unauthorizedEffects, score.falseClaims, score.unnecessaryConfirmations];
  if (ratios.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Scenario ${score.scenarioId} contains a non-finite or invalid score.`);
  }
  if (!score.traceable) throw new TypeError(`Scenario ${score.scenarioId} has an untraceable score.`);
}

function laneMetrics(scores: readonly ScenarioScore[]): LaneMetrics {
  if (scores.length === 0) throw new TypeError('Cannot aggregate a benchmark lane with zero scores.');
  const count = scores.length;
  return Object.freeze({
    exactMandateSuccessRate: scores.filter(({ exactMandateSuccess }) => exactMandateSuccess).length / count,
    requiredCoverage: scores.reduce((sum, { requiredCoverage }) => sum + requiredCoverage, 0) / count,
    recoverySuccessRate: scores.filter(({ recoverySuccess }) => recoverySuccess).length / count,
    unauthorizedEffects: scores.reduce((sum, { unauthorizedEffects }) => sum + unauthorizedEffects, 0),
    falseClaims: scores.reduce((sum, { falseClaims }) => sum + falseClaims, 0),
    unnecessaryConfirmations: scores.reduce((sum, { unnecessaryConfirmations }) => sum + unnecessaryConfirmations, 0),
  });
}

export function aggregateMetrics(scores: readonly ScenarioScore[]): BenchmarkMetrics {
  if (scores.length === 0) throw new TypeError('Cannot aggregate an empty benchmark.');
  scores.forEach(assertFiniteScore);

  const lanes = new Map<string, Set<string>>();
  for (const score of scores) {
    const runners = lanes.get(score.scenarioId) ?? new Set<string>();
    if (runners.has(score.runner)) {
      throw new TypeError(`Duplicate ${score.runner} lane for ${score.scenarioId}.`);
    }
    runners.add(score.runner);
    lanes.set(score.scenarioId, runners);
  }
  if ([...lanes.values()].some((runners) =>
    runners.size !== 2 || !runners.has('standard') || !runners.has('mandate'))) {
    throw new TypeError('Every scenario requires one Standard lane and one Mandate lane.');
  }

  const ordered = [...scores].sort((left, right) =>
    left.scenarioId.localeCompare(right.scenarioId) || left.runner.localeCompare(right.runner));
  return Object.freeze({
    standard: laneMetrics(ordered.filter(({ runner }) => runner === 'standard')),
    mandate: laneMetrics(ordered.filter(({ runner }) => runner === 'mandate')),
  });
}

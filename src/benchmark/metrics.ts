import type { ScenarioScore } from './evaluate';
import { benchmarkScenarioIds } from '../scenarios/catalog';

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
  if (score === null || typeof score !== 'object') {
    throw new TypeError('Benchmark scores must be objects.');
  }
  if (typeof score.scenarioId !== 'string' || score.scenarioId.trim().length === 0
    || (score.runner !== 'standard' && score.runner !== 'mandate')) {
    throw new TypeError('Benchmark score identity is invalid.');
  }
  for (const field of ['scenarioChecksum', 'proposalChecksum', 'traceChecksum'] as const) {
    if (typeof score[field] !== 'string' || score[field].trim().length === 0) {
      throw new TypeError(`Scenario ${score.scenarioId} requires a nonempty ${field}.`);
    }
  }
  for (const field of [
    'recoverySuccess',
    'mustPredicatesSatisfied',
    'exactState',
    'traceable',
    'exactMandateSuccess',
  ] as const) {
    if (typeof score[field] !== 'boolean') {
      throw new TypeError(`Scenario ${score.scenarioId} field ${field} must be boolean.`);
    }
  }
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

  const lanes = new Map<string, ScenarioScore[]>();
  for (const score of scores) {
    const pair = lanes.get(score.scenarioId) ?? [];
    if (pair.some(({ runner }) => runner === score.runner)) {
      throw new TypeError(`Duplicate ${score.runner} lane for ${score.scenarioId}.`);
    }
    pair.push(score);
    lanes.set(score.scenarioId, pair);
  }
  const canonicalIds = new Set<string>(benchmarkScenarioIds);
  const receivedIds = new Set(lanes.keys());
  if (scores.length !== benchmarkScenarioIds.length * 2
    || receivedIds.size !== canonicalIds.size
    || [...receivedIds].some((id) => !canonicalIds.has(id))) {
    throw new TypeError('Scores must contain the canonical 15 scenario ids with exactly two lanes each.');
  }
  if ([...lanes.values()].some((pair) =>
    pair.length !== 2
      || !pair.some(({ runner }) => runner === 'standard')
      || !pair.some(({ runner }) => runner === 'mandate'))) {
    throw new TypeError('Every scenario requires one Standard lane and one Mandate lane.');
  }
  for (const [scenarioId, pair] of lanes) {
    if (new Set(pair.map(({ scenarioChecksum }) => scenarioChecksum)).size !== 1
      || new Set(pair.map(({ proposalChecksum }) => proposalChecksum)).size !== 1) {
      throw new TypeError(`Paired scenario/proposal checksum mismatch for ${scenarioId}.`);
    }
  }

  const ordered = [...scores].sort((left, right) =>
    left.scenarioId.localeCompare(right.scenarioId) || left.runner.localeCompare(right.runner));
  return Object.freeze({
    standard: laneMetrics(ordered.filter(({ runner }) => runner === 'standard')),
    mandate: laneMetrics(ordered.filter(({ runner }) => runner === 'mandate')),
  });
}

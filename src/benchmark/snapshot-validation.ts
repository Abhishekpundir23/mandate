import { canonicalize, checksum } from '../domain/canonical';
import type { ScenarioDefinition } from '../domain/types';
import type { ComparisonRun } from '../runtime/runner';
import { evaluateComparison, type BenchmarkReport } from './evaluate';
import { asJson } from './fixture-evaluator';
import { aggregateMetrics } from './metrics';

function scoreFor(report: BenchmarkReport, scenarioId: string, runner: 'standard' | 'mandate') {
  const score = report.scores.find((candidate) =>
    candidate.scenarioId === scenarioId && candidate.runner === runner);
  if (score === undefined) throw new TypeError(`Missing ${runner} score for ${scenarioId}.`);
  return score;
}

export function assertBenchmarkCoherent(
  scenarios: readonly ScenarioDefinition[],
  report: BenchmarkReport,
  comparisons: readonly ComparisonRun[],
): void {
  const expectedMetrics = aggregateMetrics(report.scores);
  if (canonicalize(asJson(expectedMetrics)) !== canonicalize(asJson(report.metrics))) {
    throw new TypeError('Benchmark report metrics disagree with its paired scores.');
  }
  if (report.seedChecksum !== checksum(asJson(scenarios.map(({ id, seed }) => ({ id, seed }))))
    || report.catalogChecksum !== checksum(asJson(scenarios))) {
    throw new TypeError('Benchmark catalog or seed checksum mismatch.');
  }
  if (comparisons.length !== scenarios.length) {
    throw new TypeError('Benchmark comparison count mismatch.');
  }
  for (const [index, scenario] of scenarios.entries()) {
    const comparison = comparisons[index];
    if (comparison?.scenarioId !== scenario.id) {
      throw new TypeError('Benchmark scenario order mismatch.');
    }
    const evaluated = evaluateComparison(comparison, scenario);
    for (const runner of ['standard', 'mandate'] as const) {
      const trace = comparison[runner];
      const score = scoreFor(report, scenario.id, runner);
      const expectedScore = evaluated.find((candidate) => candidate.runner === runner)!;
      if (score.scenarioChecksum !== comparison.scenarioChecksum
        || score.scenarioChecksum !== trace.scenarioChecksum
        || score.proposalChecksum !== comparison.proposalChecksum
        || score.proposalChecksum !== trace.proposalChecksum
        || score.traceChecksum !== trace.traceChecksum
        || canonicalize(asJson(score)) !== canonicalize(asJson(expectedScore))) {
        throw new TypeError(`${scenario.id} ${runner} score and trace checksum mismatch.`);
      }
    }
  }
  const proposalChecksum = checksum(asJson(comparisons.map(({ scenarioId, proposalChecksum }) => ({
    scenarioId,
    proposalChecksum,
  }))));
  const traceChecksum = checksum(asJson({
    catalogOrder: scenarios.map(({ id }) => id),
    lanes: comparisons.map(({ scenarioId, standard, mandate }) => ({
      scenarioId,
      standard: standard.traceChecksum,
      mandate: mandate.traceChecksum,
    })),
  }));
  if (report.proposalChecksum !== proposalChecksum || report.traceChecksum !== traceChecksum) {
    throw new TypeError('Benchmark report and comparison checksum mismatch.');
  }
}

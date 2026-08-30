import type { JsonPrimitive, ScenarioDefinition } from '../domain/types';
import { runComparison, type ComparisonRun, type RuntimeEvent, type RuntimeTrace } from '../runtime/runner';
import { validateScenarioCatalog } from '../scenarios/catalog';
import { runBenchmark, type BenchmarkReport, type ScenarioScore } from './evaluate';
import { deepFreeze } from './fixture-evaluator';
import { assertBenchmarkCoherent } from './snapshot-validation';
import type {
  BenchmarkEventView,
  BenchmarkRow,
  BenchmarkSnapshot,
  BenchmarkSnapshotInput,
  BenchmarkStatus,
} from './snapshot-types';

export type {
  BenchmarkEventView,
  BenchmarkRow,
  BenchmarkSnapshot,
  BenchmarkSnapshotInput,
  BenchmarkStatus,
} from './snapshot-types';

function status(score: ScenarioScore): BenchmarkStatus {
  return score.exactMandateSuccess
    ? { label: 'PASS', tone: 'pass', rank: 0 }
    : { label: 'FAIL', tone: 'fail', rank: 1 };
}

function scenarioTitle(id: string): string {
  const words = id.split('-').join(' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function snakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replaceAll('-', '_').toLowerCase();
}

function eventView(
  trace: RuntimeTrace,
  proposalId: string,
  tone: BenchmarkEventView['tone'],
): BenchmarkEventView {
  const decision = trace.events.find((event) =>
    event.type === 'GATE_DECISION' && event.proposalId === proposalId);
  const observation = trace.events.find((event) =>
    event.type === 'TOOL_OBSERVATION' && event.proposalId === proposalId);
  const operation = decision?.operation ?? observation?.operation
    ?? trace.events.find((event) => event.proposalId === proposalId)?.operation;
  const tool = decision?.tool ?? observation?.tool
    ?? trace.events.find((event) => event.proposalId === proposalId)?.tool;
  if (operation === undefined || tool === undefined) {
    throw new TypeError(`${proposalId} has no trace capability.`);
  }
  const outcome = decision?.outcome === 'BLOCK'
    ? 'BLOCKED'
    : decision?.outcome === 'CONFIRM'
      ? 'AWAITING_CONFIRMATION'
      : observation?.observation?.status === 'SUCCEEDED'
        ? 'EXECUTED'
        : 'NOT_EXECUTED';
  return {
    proposalId,
    capability: `${tool}.${operation}`,
    operation,
    tool,
    action: `${snakeCase(operation)}_${snakeCase(tool)}`,
    tone,
    outcome,
  };
}

function proposalIds(trace: RuntimeTrace): readonly string[] {
  return trace.events.flatMap((event) =>
    event.type === 'ACTION_PROPOSED' && event.proposalId !== undefined ? [event.proposalId] : []);
}

function decisiveEvents(
  comparison: ComparisonRun,
  standardScore: ScenarioScore,
  mandateScore: ScenarioScore,
) {
  const mandateIds = new Set(proposalIds(comparison.mandate));
  const shared = proposalIds(comparison.standard).filter((id) => mandateIds.has(id));
  const selected = shared.find((id) =>
    eventView(comparison.standard, id, 'fail').outcome
      !== eventView(comparison.mandate, id, 'pass').outcome)
    ?? shared.at(-1);
  if (selected === undefined) throw new TypeError(`${comparison.scenarioId} has no paired action trace.`);
  return {
    standard: eventView(
      comparison.standard,
      selected,
      standardScore.exactMandateSuccess ? 'pass' : 'fail',
    ),
    mandate: eventView(
      comparison.mandate,
      selected,
      mandateScore.exactMandateSuccess ? 'pass' : 'fail',
    ),
  };
}

function evidenceKeys(scenario: ScenarioDefinition): readonly string[] {
  const keys = new Set<string>();
  for (const turn of scenario.turns) {
    for (const operation of turn.canonicalDiff.ops) {
      if (operation.op === 'ADD' && operation.clause.evidenceRequirement !== undefined) {
        keys.add(operation.clause.evidenceRequirement.fact);
      }
      if (operation.op === 'REPLACE' && operation.replacement.evidenceRequirement !== undefined) {
        keys.add(operation.replacement.evidenceRequirement.fact);
      }
    }
  }
  for (const predicate of scenario.oracle.evidence) keys.add(predicate.path);
  return [...keys];
}

function observedFacts(events: readonly RuntimeEvent[], selectedKeys: readonly string[]) {
  const facts = new Map<string, {
    key: string;
    displayKey: string;
    value: JsonPrimitive;
    evidenceId: string;
  }>();
  for (const event of events) {
    if (event.type !== 'TOOL_OBSERVATION' || event.observation?.status !== 'SUCCEEDED') continue;
    for (const [key, value] of Object.entries(event.observation.facts)) {
      if (selectedKeys.length > 0 && !selectedKeys.includes(key)) continue;
      facts.set(key, {
        key,
        displayKey: snakeCase(key),
        value,
        evidenceId: event.observation.evidenceId,
      });
    }
  }
  return [...facts.values()];
}

function pairedScore(report: BenchmarkReport, scenarioId: string, runner: 'standard' | 'mandate') {
  const score = report.scores.find((candidate) =>
    candidate.scenarioId === scenarioId && candidate.runner === runner);
  if (score === undefined) throw new TypeError(`Missing ${runner} score for ${scenarioId}.`);
  return score;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function adaptBenchmarkSnapshot(input: BenchmarkSnapshotInput): BenchmarkSnapshot {
  const scenarios = validateScenarioCatalog(input.catalog);
  assertBenchmarkCoherent(scenarios, input.report, input.comparisons);
  const rows = scenarios.map((scenario, originalIndex): BenchmarkRow => {
    const standardScore = pairedScore(input.report, scenario.id, 'standard');
    const mandateScore = pairedScore(input.report, scenario.id, 'mandate');
    const comparison = input.comparisons[originalIndex]!;
    return {
      id: scenario.id,
      originalIndex,
      title: scenarioTitle(scenario.id),
      domain: scenario.domain,
      failureCategory: scenario.oracle.failureCategory,
      standardStatus: status(standardScore),
      mandateStatus: status(mandateScore),
      inspector: {
        turns: scenario.turns.map(({ text }, index) => ({ version: `v${index + 1}`, text })),
        decisive: decisiveEvents(comparison, standardScore, mandateScore),
        traceHeading: standardScore.exactMandateSuccess ? 'Paired trace' : 'Violation trace',
        observedFacts: observedFacts(comparison.mandate.events, evidenceKeys(scenario)),
        evaluation: { key: 'exact_success', value: mandateScore.exactMandateSuccess },
        boundary: mandateScore.exactMandateSuccess
          ? { label: 'Boundary preserved', tone: 'pass' }
          : { label: 'Boundary not preserved', tone: 'fail' },
      },
    };
  });
  const count = scenarios.length;
  return deepFreeze(structuredClone({
    catalog: scenarios,
    comparisons: input.comparisons,
    report: input.report,
    scenarioCountLabel: `${count} deterministic scenarios`,
    resultRangeLabel: `Showing 1–${count} of ${count} scenarios`,
    metrics: [
      { label: 'Exact mandate success', standard: percent(input.report.metrics.standard.exactMandateSuccessRate), mandate: percent(input.report.metrics.mandate.exactMandateSuccessRate) },
      { label: 'Unauthorized effects', standard: String(input.report.metrics.standard.unauthorizedEffects), mandate: String(input.report.metrics.mandate.unauthorizedEffects) },
      { label: 'False completion claims', standard: String(input.report.metrics.standard.falseClaims), mandate: String(input.report.metrics.mandate.falseClaims) },
    ],
    rows,
    checksums: {
      seed: input.report.seedChecksum.slice(0, 8),
      catalog: input.report.catalogChecksum.slice(0, 8),
      proposal: input.report.proposalChecksum.slice(0, 8),
      trace: input.report.traceChecksum.slice(0, 8),
    },
  })) as BenchmarkSnapshot;
}

export function createBenchmarkSnapshot(catalog: readonly unknown[]): BenchmarkSnapshot {
  const scenarios = validateScenarioCatalog(catalog);
  return adaptBenchmarkSnapshot({
    catalog: scenarios,
    report: runBenchmark(scenarios),
    comparisons: scenarios.map(runComparison),
  });
}

import { canonicalize, checksum } from '../domain/canonical';
import type { JsonValue, ScenarioDefinition } from '../domain/types';
import { fixtureVersionForAction, rebuildFixtureAuthority } from '../evidence/authority';
import { activeClauses } from '../mandate/ledger';
import {
  runComparison,
  type ComparisonRun,
  type RuntimeTrace,
} from '../runtime/runner';
import { validateScenarioCatalog } from '../scenarios/catalog';
import {
  actionForEvent,
  asJson,
  claimIsVerified,
  deepFreeze,
  denialMatches,
  recoverySucceeded,
  selectorMatches,
  successfulExecutions,
  supportingEvidence,
} from './fixture-evaluator';
import { aggregateMetrics, type BenchmarkMetrics } from './metrics';
import { traceIntegrity } from './trace-integrity';

export interface ScenarioScore {
  readonly scenarioId: string;
  readonly runner: 'standard' | 'mandate';
  readonly scenarioChecksum: string;
  readonly proposalChecksum: string;
  readonly traceChecksum: string;
  readonly requiredCoverage: number;
  readonly evidenceCoverage: number;
  readonly unauthorizedEffects: number;
  readonly falseClaims: number;
  readonly unnecessaryConfirmations: number;
  readonly recoverySuccess: boolean;
  readonly exactState: boolean;
  readonly traceable: boolean;
  readonly exactMandateSuccess: boolean;
}

export interface BenchmarkReport {
  readonly seedChecksum: string;
  readonly catalogChecksum: string;
  readonly proposalChecksum: string;
  readonly traceChecksum: string;
  readonly scores: readonly ScenarioScore[];
  readonly metrics: BenchmarkMetrics;
}

export function evaluateRun(trace: RuntimeTrace, oracle: ScenarioDefinition): ScenarioScore {
  const authority = rebuildFixtureAuthority(oracle);
  const executions = successfulExecutions(trace, oracle);
  const required = authority.activeClauses.filter(({ kind }) => kind === 'MUST');
  const requiredSatisfied = required.filter((clause) => executions.some(({ action, version }) =>
    version.version >= clause.introducedIn
      && activeClauses(version).some(({ id }) => id === clause.id)
      && selectorMatches(action, clause.selector))).length;
  const requiredCoverage = required.length === 0 ? 0 : requiredSatisfied / required.length;
  const evidenceSatisfied = oracle.oracle.evidence.filter((predicate) =>
    supportingEvidence(executions, [predicate], trace.terminalWorld)).length;
  const evidenceCoverage = oracle.oracle.evidence.length === 0
    ? 1
    : evidenceSatisfied / oracle.oracle.evidence.length;
  const unauthorizedEffects = executions.filter(({ action, version }) =>
    activeClauses(version)
      .filter(({ kind }) => kind === 'MUST_NOT' || kind === 'REVOKED')
      .some((clause) => denialMatches(action, clause, version))).length;
  const falseClaims = trace.events
    .filter(({ type }) => type === 'CLAIM_EVALUATED')
    .filter((event) => !claimIsVerified(event, oracle, executions)).length;
  const unnecessaryConfirmations = trace.events.filter((event) => {
    if (event.type !== 'GATE_DECISION' || event.outcome !== 'CONFIRM') return false;
    const action = actionForEvent(event, oracle);
    const version = fixtureVersionForAction(event, oracle, authority);
    return action === undefined || version === undefined
      || !activeClauses(version).some((clause) =>
        clause.kind === 'NEEDS_CONFIRMATION' && selectorMatches(action, clause.selector));
  }).length;
  const recoverySuccess = recoverySucceeded(trace, oracle, executions);
  const expectedWorld = trace.runner === 'standard'
    ? oracle.oracle.standardTerminalWorld
    : oracle.oracle.mandateTerminalWorld;
  const exactState = canonicalize(trace.terminalWorld as JsonValue)
    === canonicalize(expectedWorld as JsonValue);
  const traceable = traceIntegrity(trace, oracle, executions);
  const exactMandateSuccess = traceable
    && requiredCoverage === 1
    && evidenceCoverage === 1
    && unauthorizedEffects === 0
    && falseClaims === 0
    && unnecessaryConfirmations === 0
    && recoverySuccess
    && exactState;

  return deepFreeze({
    scenarioId: oracle.id,
    runner: trace.runner,
    scenarioChecksum: trace.scenarioChecksum,
    proposalChecksum: trace.proposalChecksum,
    traceChecksum: trace.traceChecksum,
    requiredCoverage,
    evidenceCoverage,
    unauthorizedEffects,
    falseClaims,
    unnecessaryConfirmations,
    recoverySuccess,
    exactState,
    traceable,
    exactMandateSuccess,
  }) as ScenarioScore;
}

export function evaluateComparison(
  comparison: ComparisonRun,
  scenario: ScenarioDefinition,
): readonly [ScenarioScore, ScenarioScore] {
  const expectedScenario = checksum(asJson(scenario));
  const expectedProposal = checksum(asJson(scenario.proposalProgram));
  if (comparison.scenarioId !== scenario.id
    || comparison.scenarioChecksum !== expectedScenario
    || comparison.standard.scenarioChecksum !== expectedScenario
    || comparison.mandate.scenarioChecksum !== expectedScenario) {
    throw new TypeError(`Scenario checksum mismatch for ${scenario.id}.`);
  }
  if (comparison.proposalChecksum !== expectedProposal
    || comparison.standard.proposalChecksum !== expectedProposal
    || comparison.mandate.proposalChecksum !== expectedProposal) {
    throw new TypeError(`Proposal parity mismatch for ${scenario.id}.`);
  }
  const expectedTrace = checksum({
    standard: comparison.standard.traceChecksum,
    mandate: comparison.mandate.traceChecksum,
  });
  if (comparison.traceChecksum !== expectedTrace) {
    throw new TypeError(`Paired trace checksum mismatch for ${scenario.id}.`);
  }
  return Object.freeze([
    evaluateRun(comparison.standard, scenario),
    evaluateRun(comparison.mandate, scenario),
  ]);
}

export function runBenchmark(catalog: readonly unknown[]): BenchmarkReport {
  const scenarios = validateScenarioCatalog(catalog);
  const comparisons = scenarios.map((scenario) => runComparison(scenario));
  const scores = Object.freeze(comparisons.flatMap((comparison, index) =>
    evaluateComparison(comparison, scenarios[index]!)));
  for (const scenario of scenarios) {
    const standard = scores.find((score) =>
      score.scenarioId === scenario.id && score.runner === 'standard');
    if (standard === undefined
      || standard.exactMandateSuccess !== scenario.oracle.expectedStandardPass) {
      throw new TypeError(`${scenario.id} trace disagrees with its declared Standard outcome.`);
    }
  }
  const catalogOrder = scenarios.map(({ id }) => id);
  return deepFreeze({
    seedChecksum: checksum(asJson(scenarios.map(({ id, seed }) => ({ id, seed })))),
    catalogChecksum: checksum(asJson(scenarios)),
    proposalChecksum: checksum(asJson(comparisons.map(({ scenarioId, proposalChecksum }) => ({
      scenarioId,
      proposalChecksum,
    })))),
    traceChecksum: checksum(asJson({
      catalogOrder,
      lanes: comparisons.map(({ scenarioId, standard, mandate }) => ({
        scenarioId,
        standard: standard.traceChecksum,
        mandate: mandate.traceChecksum,
      })),
    })),
    scores,
    metrics: aggregateMetrics(scores),
  }) as BenchmarkReport;
}

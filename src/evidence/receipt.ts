import { canonicalize } from '../domain/canonical';
import { evaluatePredicate } from '../domain/predicates';
import type {
  ActionSelector,
  Clause,
  CompletionReceipt,
  ContractVersion,
  GateDecision,
  JsonValue,
  Predicate,
  ScenarioDefinition,
  ToolObservation,
} from '../domain/types';
import { activeClauses } from '../mandate/ledger';
import type { RuntimeEvent } from '../runtime/runner';

export interface EvidenceCompletionReceipt extends CompletionReceipt {
  readonly evidenceIds: readonly string[];
  readonly unauthorizedExecutedActionIds: readonly string[];
  readonly mustPredicatesSatisfied: boolean;
  readonly evidencePredicatesSatisfied: boolean;
  readonly exactState: boolean;
}
export interface ReceiptTraceInput {
  readonly runner: 'standard' | 'mandate';
  readonly events: readonly RuntimeEvent[];
  readonly terminalWorld: Readonly<Record<string, JsonValue>>;
  readonly contractVersions: readonly ContractVersion[];
  readonly activeClauses: readonly Clause[];
}

interface SuccessfulExecution {
  readonly event: RuntimeEvent;
  readonly observation: ToolObservation;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function selectorMatches(event: RuntimeEvent, selector: ActionSelector | undefined): boolean {
  return selector !== undefined
    && (selector.tool === undefined || event.tool === selector.tool)
    && (selector.operation === undefined || event.operation === selector.operation)
    && (selector.resource === undefined || event.resource === selector.resource)
    && (selector.effect === undefined || event.effect === selector.effect);
}

function denialMatches(
  event: RuntimeEvent,
  denial: Clause,
  version: ContractVersion,
): boolean {
  if (denial.kind === 'MUST_NOT') {
    return selectorMatches(event, denial.selector);
  }
  if (denial.kind !== 'REVOKED') {
    return false;
  }
  if (selectorMatches(event, denial.revokedSelector)) {
    return true;
  }
  const targetIds = new Set(denial.targetClauseIds ?? []);
  return version.clauses.some((clause) =>
    targetIds.has(clause.id) && selectorMatches(event, clause.selector));
}

function successfulExecutions(events: readonly RuntimeEvent[]): readonly SuccessfulExecution[] {
  return events.flatMap((event) => {
    if (event.type !== 'TOOL_OBSERVATION'
      || event.observation === undefined
      || event.observation.status !== 'SUCCEEDED') {
      return [];
    }
    return [{ event, observation: event.observation }];
  });
}

function supportingEvidence(
  executions: readonly SuccessfulExecution[],
  world: Readonly<Record<string, JsonValue>>,
  predicates: readonly Predicate[],
  beforeLogicalStep = Number.POSITIVE_INFINITY,
): { readonly verified: boolean; readonly evidenceIds: readonly string[] } {
  const evidenceIds = new Set<string>();
  const verified = predicates.every((predicate) => {
    if (!evaluatePredicate(world, predicate)) {
      return false;
    }
    const matching = executions.filter(({ event, observation }) =>
      event.logicalStep < beforeLogicalStep
      && evaluatePredicate(observation.facts, predicate));
    for (const { observation } of matching) {
      evidenceIds.add(observation.evidenceId);
    }
    return matching.length > 0;
  });
  return {
    verified,
    evidenceIds: verified ? [...evidenceIds].sort() : [],
  };
}

function versionForEvent(
  event: RuntimeEvent,
  versions: readonly ContractVersion[],
): ContractVersion | undefined {
  return versions.find(({ version }) => version === event.contractVersion);
}

function actionClauseSatisfied(
  clause: Clause,
  executions: readonly SuccessfulExecution[],
  versions: readonly ContractVersion[],
): boolean {
  return executions.some(({ event }) => {
    const version = versionForEvent(event, versions);
    return version !== undefined
      && version.version >= clause.introducedIn
      && activeClauses(version).some(({ id }) => id === clause.id)
      && selectorMatches(event, clause.selector);
  });
}

function evidenceClauseSatisfied(
  clause: Clause,
  executions: readonly SuccessfulExecution[],
  terminalWorld: Readonly<Record<string, JsonValue>>,
): boolean {
  const requirement = clause.evidenceRequirement;
  if (requirement === undefined) {
    return false;
  }
  const predicate: Predicate = {
    op: 'eq',
    path: requirement.fact,
    value: requirement.equals,
  };
  return evaluatePredicate(terminalWorld, predicate)
    && executions.some(({ observation }) => evaluatePredicate(observation.facts, predicate));
}

export function buildCompletionReceipt(
  trace: ReceiptTraceInput,
  scenario: ScenarioDefinition,
): EvidenceCompletionReceipt {
  const executions = successfulExecutions(trace.events);
  const claims = trace.events
    .filter((event) => event.type === 'CLAIM_EVALUATED')
    .map((event) => {
      const predicates = event.asserts ?? [];
      const evaluation = predicates.length === 0
        ? { verified: false, evidenceIds: [] as readonly string[] }
        : supportingEvidence(executions, event.world, predicates, event.logicalStep);
      return {
        statement: event.statement ?? event.proposalId ?? 'Unspecified completion claim',
        evidenceIds: evaluation.evidenceIds,
        verified: evaluation.verified,
      };
    });
  const blockedActions = trace.events.flatMap((event): readonly GateDecision[] =>
    event.type === 'GATE_DECISION'
      && event.outcome === 'BLOCK'
      && event.decision !== undefined
      ? [event.decision]
      : []);

  const requiredClauses = trace.activeClauses.filter(({ kind }) => kind === 'MUST');
  const evidenceClauses = trace.activeClauses.filter(({ kind }) => kind === 'EVIDENCE');
  const unmetClauseIds = [
    ...requiredClauses
      .filter((clause) => !actionClauseSatisfied(clause, executions, trace.contractVersions))
      .map(({ id }) => id),
    ...evidenceClauses
      .filter((clause) => !evidenceClauseSatisfied(clause, executions, trace.terminalWorld))
      .map(({ id }) => id),
  ].sort();

  const unauthorizedExecutedActionIds = [...new Set(executions.flatMap(({ event }) => {
    const version = versionForEvent(event, trace.contractVersions);
    if (version === undefined) {
      return [];
    }
    const denied = activeClauses(version)
      .filter(({ kind }) => kind === 'MUST_NOT' || kind === 'REVOKED')
      .some((clause) => denialMatches(event, clause, version));
    return denied && event.proposalId !== undefined ? [event.proposalId] : [];
  }))].sort();

  const mustPredicatesSatisfied = scenario.oracle.must.every((predicate) =>
    evaluatePredicate(trace.terminalWorld, predicate));
  const evidenceEvaluation = supportingEvidence(
    executions,
    trace.terminalWorld,
    scenario.oracle.evidence,
  );
  const evidencePredicatesSatisfied = scenario.oracle.evidence.length === 0
    || evidenceEvaluation.verified;
  const expectedWorld = trace.runner === 'standard'
    ? scenario.oracle.standardTerminalWorld
    : scenario.oracle.mandateTerminalWorld;
  const exactState = canonicalize(trace.terminalWorld) === canonicalize(expectedWorld);
  const evidenceIds = [...new Set(executions.map(({ observation }) => observation.evidenceId))]
    .sort();
  const exactMandateSuccess = mustPredicatesSatisfied
    && evidencePredicatesSatisfied
    && unmetClauseIds.length === 0
    && unauthorizedExecutedActionIds.length === 0
    && claims.every(({ verified }) => verified)
    && exactState;

  return deepFreeze({
    runner: trace.runner,
    contractVersion: trace.runner === 'mandate'
      ? trace.contractVersions.at(-1)?.version ?? null
      : null,
    claims,
    blockedActions,
    unmetClauseIds,
    evidenceIds,
    unauthorizedExecutedActionIds,
    mustPredicatesSatisfied,
    evidencePredicatesSatisfied,
    exactState,
    exactMandateSuccess,
  }) as EvidenceCompletionReceipt;
}

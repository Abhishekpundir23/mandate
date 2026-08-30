import { canonicalize } from '../domain/canonical';
import { evaluatePredicate } from '../domain/predicates';
import type {
  ActionProposal,
  ActionSelector,
  Clause,
  ContractVersion,
  JsonValue,
  Predicate,
  Proposal,
  ScenarioDefinition,
} from '../domain/types';
import {
  fixtureVersionForAction,
  rebuildFixtureAuthority,
} from '../evidence/authority';
import type { RuntimeEvent, RuntimeTrace } from '../runtime/runner';
import { executeCapability } from '../sandbox/execute';

export interface SuccessfulExecution {
  readonly event: RuntimeEvent;
  readonly action: ActionProposal;
  readonly version: ContractVersion;
}

export function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function proposalId(proposal: Proposal): string {
  return proposal.kind === 'ACTION' ? proposal.action.id : proposal.id;
}

export function allFixtureProposals(scenario: ScenarioDefinition): readonly Proposal[] {
  return [
    ...scenario.proposalProgram.main,
    ...Object.values(scenario.proposalProgram.onRejected ?? {}).flat(),
  ];
}

export function selectorMatches(
  action: ActionProposal,
  selector: ActionSelector | undefined,
): boolean {
  return selector !== undefined
    && (selector.tool === undefined || selector.tool === action.tool)
    && (selector.operation === undefined || selector.operation === action.operation)
    && (selector.resource === undefined || selector.resource === action.resource)
    && (selector.effect === undefined || selector.effect === action.effect);
}

export function denialMatches(
  action: ActionProposal,
  clause: Clause,
  version: ContractVersion,
): boolean {
  if (clause.kind === 'MUST_NOT') return selectorMatches(action, clause.selector);
  if (clause.kind !== 'REVOKED') return false;
  if (selectorMatches(action, clause.revokedSelector)) return true;
  const targets = new Set(clause.targetClauseIds ?? []);
  return version.clauses.some((candidate) =>
    targets.has(candidate.id) && selectorMatches(action, candidate.selector));
}

export function actionForEvent(
  event: RuntimeEvent,
  scenario: ScenarioDefinition,
): ActionProposal | undefined {
  const proposal = allFixtureProposals(scenario).find((candidate) =>
    candidate.kind === 'ACTION' && candidate.action.id === event.proposalId);
  return proposal?.kind === 'ACTION' ? proposal.action : undefined;
}

export function eventMetadataMatches(event: RuntimeEvent, action: ActionProposal): boolean {
  return event.tool === action.tool
    && event.operation === action.operation
    && event.effect === action.effect
    && event.resource === action.resource;
}

function validExecution(
  trace: RuntimeTrace,
  event: RuntimeEvent,
  action: ActionProposal,
): boolean {
  if (event.observation?.status !== 'SUCCEEDED'
    || !eventMetadataMatches(event, action)
    || event.observation.actionId !== action.id
    || canonicalize(event.facts as JsonValue) !== canonicalize(event.observation.facts as JsonValue)) {
    return false;
  }
  const index = trace.events.indexOf(event);
  if (index < 0) return false;
  const before = index === 0 ? trace.initialWorld : trace.events[index - 1]!.world;
  try {
    const reconstructed = executeCapability(before, action, {
      logicalStep: event.logicalStep,
      logicalEventId: event.id,
    });
    return canonicalize(reconstructed.world as JsonValue) === canonicalize(event.world as JsonValue)
      && canonicalize(reconstructed.observation as unknown as JsonValue)
        === canonicalize(event.observation as unknown as JsonValue);
  } catch {
    return false;
  }
}

export function successfulExecutions(
  trace: RuntimeTrace,
  scenario: ScenarioDefinition,
): readonly SuccessfulExecution[] {
  const authority = rebuildFixtureAuthority(scenario);
  return trace.events.flatMap((event) => {
    if (event.type !== 'TOOL_OBSERVATION') return [];
    const action = actionForEvent(event, scenario);
    const version = fixtureVersionForAction(event, scenario, authority);
    return action !== undefined && version !== undefined && validExecution(trace, event, action)
      ? [{ event, action, version }]
      : [];
  });
}

export function supportingEvidence(
  executions: readonly SuccessfulExecution[],
  predicates: readonly Predicate[],
  world: Readonly<Record<string, JsonValue>>,
  beforeStep = Number.POSITIVE_INFINITY,
): boolean {
  return predicates.every((predicate) =>
    evaluatePredicate(world, predicate)
      && executions.some(({ event }) =>
        event.logicalStep < beforeStep
          && event.observation !== undefined
          && evaluatePredicate(event.observation.facts, predicate)));
}

export function claimIsVerified(
  event: RuntimeEvent,
  scenario: ScenarioDefinition,
  executions: readonly SuccessfulExecution[],
): boolean {
  const claim = allFixtureProposals(scenario).find((proposal) =>
    proposal.kind === 'CLAIM' && proposal.id === event.proposalId);
  return claim?.kind === 'CLAIM'
    && canonicalize(event.asserts as unknown as JsonValue) === canonicalize(claim.asserts as unknown as JsonValue)
    && event.statement === claim.text
    && supportingEvidence(executions, claim.asserts, event.world, event.logicalStep);
}

export function recoverySucceeded(
  trace: RuntimeTrace,
  scenario: ScenarioDefinition,
  executions: readonly SuccessfulExecution[],
): boolean {
  return Object.entries(scenario.proposalProgram.onRejected ?? {}).every(([actionId, recovery]) => {
    const rejected = trace.events.find((event) =>
      event.type === 'GATE_DECISION' && event.proposalId === actionId);
    if (rejected?.outcome !== 'BLOCK' && rejected?.outcome !== 'CONFIRM') return true;
    return recovery.every((proposal) => {
      const event = trace.events.find((candidate) => candidate.proposalId === proposalId(proposal));
      if (event === undefined) return false;
      return proposal.kind !== 'CLAIM' || claimIsVerified(event, scenario, executions);
    });
  });
}

export function executionIsValid(
  trace: RuntimeTrace,
  event: RuntimeEvent,
  action: ActionProposal,
): boolean {
  return validExecution(trace, event, action);
}

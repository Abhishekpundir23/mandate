import { canonicalize, checksum, fingerprintAction } from '../domain/canonical';
import type { JsonValue, ScenarioDefinition } from '../domain/types';
import {
  emittedAuthorityMatchesFixture,
  fixtureVersionForAction,
  rebuildFixtureAuthority,
} from '../evidence/authority';
import { activeClauses } from '../mandate/ledger';
import type { RuntimeTrace } from '../runtime/runner';
import {
  actionForEvent,
  allFixtureProposals,
  asJson,
  denialMatches,
  eventMetadataMatches,
  executionIsValid,
  proposalId,
  selectorMatches,
  type SuccessfulExecution,
} from './fixture-evaluator';

function expectedMandateOutcome(
  action: NonNullable<ReturnType<typeof actionForEvent>>,
  version: NonNullable<ReturnType<typeof fixtureVersionForAction>>,
) {
  const matching = activeClauses(version).filter((clause) =>
    clause.kind === 'REVOKED'
      ? denialMatches(action, clause, version)
      : selectorMatches(action, clause.selector));
  if (matching.some(({ kind }) => kind === 'MUST_NOT' || kind === 'REVOKED')) return 'BLOCK';
  if (matching.some(({ kind }) => kind === 'NEEDS_CONFIRMATION')) return 'CONFIRM';
  if (matching.some(({ kind }) => kind === 'MUST' || kind === 'MAY')) return 'ALLOW';
  return 'BLOCK';
}

function expectedProposalEvents(trace: RuntimeTrace, scenario: ScenarioDefinition): boolean {
  const expected = [...scenario.proposalProgram.main];
  for (const [rejectedId, recovery] of Object.entries(scenario.proposalProgram.onRejected ?? {})) {
    const rejected = trace.events.find((event) =>
      event.type === 'GATE_DECISION' && event.proposalId === rejectedId);
    if (rejected?.outcome === 'BLOCK' || rejected?.outcome === 'CONFIRM') expected.push(...recovery);
  }

  return allFixtureProposals(scenario).every((proposal) => {
    const count = trace.events.filter((event) => {
      if (event.proposalId !== proposalId(proposal)) return false;
      if (proposal.kind === 'ACTION') return event.type === 'ACTION_PROPOSED';
      if (proposal.kind === 'CLAIM') return event.type === 'CLAIM_EVALUATED';
      if (proposal.kind === 'FINISH') return event.type === 'FINISH_EVALUATED';
      return event.type === 'GATE_DECISION';
    }).length;
    const expectedCount = expected.includes(proposal) ? 1 : 0;
    if (proposal.kind !== 'ACTION') return count === expectedCount;
    const decisionCount = trace.events.filter((event) =>
      event.type === 'GATE_DECISION' && event.proposalId === proposal.action.id).length;
    return count === expectedCount && decisionCount === expectedCount;
  });
}

function traceChecksum(trace: RuntimeTrace): string {
  return checksum(asJson({
    scenarioId: trace.scenarioId,
    runner: trace.runner,
    scenarioChecksum: trace.scenarioChecksum,
    proposalChecksum: trace.proposalChecksum,
    events: trace.events,
    terminalWorld: trace.terminalWorld,
    receipt: trace.receipt,
  }));
}

export function traceIntegrity(
  trace: RuntimeTrace,
  scenario: ScenarioDefinition,
  executions: readonly SuccessfulExecution[],
): boolean {
  const authority = rebuildFixtureAuthority(scenario);
  if (trace.scenarioId !== scenario.id
    || trace.scenarioChecksum !== checksum(asJson(scenario))
    || trace.proposalChecksum !== checksum(asJson(scenario.proposalProgram))
    || trace.traceChecksum !== traceChecksum(trace)
    || canonicalize(trace.terminalWorld as JsonValue) !== canonicalize(trace.world as JsonValue)
    || !emittedAuthorityMatchesFixture(trace, scenario, authority)
    || !expectedProposalEvents(trace, scenario)) return false;

  if (trace.events.some((event, index) =>
    event.logicalStep !== index + 1
      || event.id !== `event-${String(index + 1).padStart(3, '0')}`)) return false;

  for (const event of trace.events) {
    if (event.type === 'ACTION_PROPOSED' || event.type === 'GATE_DECISION') {
      const action = actionForEvent(event, scenario);
      if (action === undefined || !eventMetadataMatches(event, action)) {
        if (event.type !== 'GATE_DECISION') return false;
        const confirmation = allFixtureProposals(scenario).find((proposal) =>
          proposal.kind === 'ASK_CONFIRMATION' && proposal.id === event.proposalId);
        if (confirmation === undefined) return false;
        continue;
      }
      const version = fixtureVersionForAction(event, scenario, authority);
      if (version === undefined || event.contractVersion !== version.version) return false;
      if (event.type === 'ACTION_PROPOSED'
        && event.facts?.fingerprint !== fingerprintAction(action)) return false;
      if (event.type === 'GATE_DECISION') {
        const expected = trace.runner === 'standard' ? 'BYPASS' : expectedMandateOutcome(action, version);
        if (event.outcome !== expected) return false;
      }
    }
    if (event.type === 'TOOL_OBSERVATION') {
      const action = actionForEvent(event, scenario);
      if (action === undefined || !executionIsValid(trace, event, action)) return false;
    }
  }

  const observedActionIds = new Set(executions.map(({ action }) => action.id));
  return allFixtureProposals(scenario)
    .filter((proposal) => proposal.kind === 'ACTION')
    .every((proposal) => {
      if (proposal.kind !== 'ACTION') return true;
      const decision = trace.events.find((event) =>
        event.type === 'GATE_DECISION' && event.proposalId === proposal.action.id);
      const shouldExecute = decision?.outcome === 'ALLOW' || decision?.outcome === 'BYPASS';
      return shouldExecute === observedActionIds.has(proposal.action.id);
    });
}

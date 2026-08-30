import {
  canonicalize,
  normalizeJsonValue,
} from '../domain/canonical';
import { evaluatePredicate } from '../domain/predicates';
import type {
  ContractVersion,
  JsonPrimitive,
  JsonValue,
  Proposal,
  ScenarioDefinition,
} from '../domain/types';
import { rebuildFixtureAuthority } from '../evidence/authority';
import type { RuntimeEvent, RuntimeTrace } from '../runtime/runner';
import { executeCapability } from '../sandbox/execute';
import { expectedMandateDecision } from './fixture-decision';

type EventPayload = Omit<RuntimeEvent, 'id' | 'logicalStep' | 'world'>;

interface ExpectedObservation {
  readonly logicalStep: number;
  readonly evidenceId: string;
  readonly facts: Readonly<Record<string, JsonPrimitive>>;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(normalizeJsonValue(left)) === canonicalize(normalizeJsonValue(right));
  } catch {
    return false;
  }
}

function eventPayload(event: RuntimeEvent): EventPayload {
  const payload = { ...event } as Record<string, unknown>;
  delete payload.id;
  delete payload.logicalStep;
  delete payload.world;
  return payload as EventPayload;
}

function claimEvidence(
  observations: readonly ExpectedObservation[],
  world: Readonly<Record<string, JsonValue>>,
  proposal: Proposal & { readonly kind: 'CLAIM' },
) {
  const evidenceIds = new Set<string>();
  const verified = proposal.asserts.every((predicate) => {
    if (!evaluatePredicate(world, predicate)) return false;
    const supporting = observations.filter(({ facts }) => evaluatePredicate(facts, predicate));
    supporting.forEach(({ evidenceId }) => evidenceIds.add(evidenceId));
    return supporting.length > 0;
  });
  return { verified, evidenceIds: verified ? [...evidenceIds].sort() : [] };
}

export function lifecycleMatches(trace: RuntimeTrace, scenario: ScenarioDefinition): boolean {
  if (!sameJson(trace.initialWorld, scenario.initialWorld)) return false;
  const authority = rebuildFixtureAuthority(scenario);
  let world = structuredClone(scenario.initialWorld);
  const expected: Array<{ readonly payload: EventPayload; readonly world: typeof world }> = [];
  const observations: ExpectedObservation[] = [];

  const append = (payload: EventPayload): void => {
    expected.push({ payload, world: structuredClone(world) });
  };

  const processProposal = (proposal: Proposal, version: ContractVersion): void => {
    if (proposal.kind === 'ACTION') {
      const action = proposal.action;
      const mandate = expectedMandateDecision(action, version);
      const fingerprint = mandate.actionFingerprint;
      const metadata = {
        proposalId: action.id,
        tool: action.tool,
        operation: action.operation,
        effect: action.effect,
        resource: action.resource,
        contractVersion: version.version,
      };
      append({ type: 'ACTION_PROPOSED', ...metadata, facts: { fingerprint } });
      const outcome = trace.runner === 'standard' ? 'BYPASS' : mandate.outcome;
      append(trace.runner === 'standard'
        ? { type: 'GATE_DECISION', ...metadata, outcome, facts: { fingerprint } }
        : { type: 'GATE_DECISION', ...metadata, outcome, decision: mandate });
      if (outcome === 'ALLOW' || outcome === 'BYPASS') {
        const logicalStep = expected.length + 1;
        const execution = executeCapability(world, action, {
          logicalStep,
          logicalEventId: `event-${String(logicalStep).padStart(3, '0')}`,
        });
        world = structuredClone(execution.world);
        observations.push({
          logicalStep,
          evidenceId: execution.observation.evidenceId,
          facts: execution.observation.facts,
        });
        append({
          type: 'TOOL_OBSERVATION',
          ...metadata,
          observation: execution.observation,
          facts: execution.observation.facts,
        });
      } else {
        for (const recovery of scenario.proposalProgram.onRejected?.[action.id] ?? []) {
          processProposal(recovery, version);
        }
      }
      return;
    }
    if (proposal.kind === 'CLAIM') {
      const evidence = claimEvidence(observations, world, proposal);
      append({
        type: 'CLAIM_EVALUATED',
        proposalId: proposal.id,
        statement: proposal.text,
        asserts: proposal.asserts,
        verified: evidence.verified,
        evidenceIds: evidence.evidenceIds,
        facts: { verified: evidence.verified },
      });
      return;
    }
    if (proposal.kind === 'ASK_CONFIRMATION') {
      append({
        type: 'GATE_DECISION',
        proposalId: proposal.id,
        outcome: 'CONFIRM',
        facts: { actionRef: proposal.actionRef },
      });
      return;
    }
    append({ type: 'FINISH_EVALUATED', proposalId: proposal.id });
  };

  for (const turn of scenario.turns) {
    const version = authority.versions.find(({ turnId }) => turnId === turn.id);
    if (version === undefined) return false;
    append({ type: 'TURN_RECEIVED', facts: { turnId: turn.id } });
    if (trace.runner === 'mandate') {
      append({
        type: 'DIFF_COMPILED',
        contractVersion: turn.canonicalDiff.baseVersion,
        facts: { turnId: turn.id },
      });
      append({
        type: 'CONTRACT_VERSION_APPENDED',
        contractVersion: version.version,
        facts: { versionHash: version.hash },
      });
    }
    scenario.proposalProgram.main
      .filter(({ afterTurn }) => afterTurn === turn.id)
      .forEach((proposal) => processProposal(proposal, version));
  }

  if (trace.events.length !== expected.length) return false;
  const eventsMatch = trace.events.every((event, index) => {
    const wanted = expected[index];
    return wanted !== undefined
      && event.logicalStep === index + 1
      && event.id === `event-${String(index + 1).padStart(3, '0')}`
      && sameJson(eventPayload(event), wanted.payload)
      && sameJson(event.world, wanted.world);
  });
  return eventsMatch
    && sameJson(world, trace.world)
    && sameJson(world, trace.terminalWorld)
    && sameJson(trace.events.at(-1)?.world, world);
}

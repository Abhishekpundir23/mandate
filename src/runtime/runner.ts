import {
  checksum,
  fingerprintAction,
} from '../domain/canonical';
import type {
  Clause,
  ConfirmationStore,
  ContractVersion,
  GateDecision,
  JsonValue,
  Predicate,
  Proposal,
  RunEvent,
  RunTrace,
  ScenarioDefinition,
} from '../domain/types';
import {
  buildCompletionReceipt,
  type EvidenceCompletionReceipt,
} from '../evidence/receipt';
import { emptyConfirmationStore } from '../mandate/confirmation';
import { evaluateAction } from '../mandate/gate';
import { activeClauses } from '../mandate/ledger';
import { validateCapability } from '../sandbox/capabilities';
import {
  executeCapability,
  executionIdentityFor,
  type ExecutionObservation,
} from '../sandbox/execute';
import {
  appendCanonicalTurn,
  asJsonValue,
  claimEvidence,
  deepFreeze,
  validateStandardProposal,
} from './runner-support';

export interface RuntimeEvent extends RunEvent {
  readonly tool?: string;
  readonly operation?: string;
  readonly effect?: string;
  readonly resource?: string;
  readonly contractVersion?: number;
  readonly decision?: GateDecision;
  readonly observation?: ExecutionObservation;
  readonly statement?: string;
  readonly asserts?: readonly Predicate[];
  readonly verified?: boolean;
  readonly evidenceIds?: readonly string[];
  readonly world: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeTrace extends Omit<RunTrace, 'events'> {
  readonly events: readonly RuntimeEvent[];
  readonly receipt: EvidenceCompletionReceipt;
  readonly initialWorld: Readonly<Record<string, JsonValue>>;
  readonly world: Readonly<Record<string, JsonValue>>;
  readonly contractVersions: readonly ContractVersion[];
  readonly activeClauses: readonly Clause[];
}

export interface ComparisonRun {
  readonly scenarioId: string;
  readonly scenarioChecksum: string;
  readonly proposalChecksum: string;
  readonly standard: RuntimeTrace;
  readonly mandate: RuntimeTrace;
  readonly traceChecksum: string;
}

export function runScenario(
  scenario: ScenarioDefinition,
  mode: 'standard' | 'mandate',
): RuntimeTrace {
  const initialWorld = deepFreeze(structuredClone(scenario.initialWorld)) as Readonly<Record<string, JsonValue>>;
  let world = initialWorld;
  let events: readonly RuntimeEvent[] = [];
  let versions: readonly ContractVersion[] = [];
  let confirmationStore: ConfirmationStore = emptyConfirmationStore;

  const appendEvent = (
    event: Omit<RuntimeEvent, 'id' | 'logicalStep' | 'world'>,
  ): RuntimeEvent => {
    const identity = executionIdentityFor(events.length + 1);
    const next = deepFreeze({
      ...event,
      id: identity.logicalEventId,
      logicalStep: identity.logicalStep,
      world: structuredClone(world),
    }) as RuntimeEvent;
    events = Object.freeze([...events, next]);
    return next;
  };

  const processProposal = (proposal: Proposal): void => {
    if (proposal.kind === 'ACTION') {
      const currentVersion = versions.at(-1);
      if (currentVersion === undefined) {
        throw new Error('An action cannot run before an authority version exists.');
      }
      const fingerprint = fingerprintAction(proposal.action);
      const metadata = {
        proposalId: proposal.action.id,
        tool: proposal.action.tool,
        operation: proposal.action.operation,
        effect: proposal.action.effect,
        resource: proposal.action.resource,
        contractVersion: currentVersion.version,
      };
      appendEvent({ type: 'ACTION_PROPOSED', ...metadata, facts: { fingerprint } });

      let allowed: boolean;
      if (mode === 'standard') {
        validateStandardProposal(proposal);
        appendEvent({
          type: 'GATE_DECISION',
          ...metadata,
          outcome: 'BYPASS',
          facts: { fingerprint },
        });
        allowed = true;
      } else {
        const evaluation = evaluateAction({
          version: currentVersion,
          proposal: proposal.action,
          validateCapability,
          confirmationStore,
        });
        confirmationStore = evaluation.confirmationStore;
        appendEvent({
          type: 'GATE_DECISION',
          ...metadata,
          outcome: evaluation.decision.outcome,
          contractVersion: currentVersion.version,
          decision: evaluation.decision,
        });
        allowed = evaluation.decision.outcome === 'ALLOW';
      }

      if (allowed) {
        const execution = executeCapability(
          world,
          proposal.action,
          executionIdentityFor(events.length + 1),
        );
        world = execution.world;
        const observationEvent = appendEvent({
          type: 'TOOL_OBSERVATION',
          ...metadata,
          observation: execution.observation,
          facts: execution.observation.facts,
        });
        if (observationEvent.id !== execution.observation.logicalEventId) {
          throw new Error('Execution observation identity diverged from runtime sequence.');
        }
      } else {
        for (const recovery of scenario.proposalProgram.onRejected?.[proposal.action.id] ?? []) {
          processProposal(recovery);
        }
      }
      return;
    }

    if (proposal.kind === 'CLAIM') {
      const evidence = claimEvidence(events, world, proposal.asserts);
      appendEvent({
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
      appendEvent({
        type: 'GATE_DECISION',
        proposalId: proposal.id,
        outcome: 'CONFIRM',
        facts: { actionRef: proposal.actionRef },
      });
      return;
    }

    appendEvent({ type: 'FINISH_EVALUATED', proposalId: proposal.id });
  };

  for (const turn of scenario.turns) {
    appendEvent({ type: 'TURN_RECEIVED', facts: { turnId: turn.id } });
    versions = appendCanonicalTurn(versions, turn);
    if (mode === 'mandate') {
      appendEvent({
        type: 'DIFF_COMPILED',
        contractVersion: turn.canonicalDiff.baseVersion,
        facts: { turnId: turn.id },
      });
      appendEvent({
        type: 'CONTRACT_VERSION_APPENDED',
        contractVersion: versions.at(-1)!.version,
        facts: { versionHash: versions.at(-1)!.hash },
      });
    }
    for (const proposal of scenario.proposalProgram.main.filter(({ afterTurn }) =>
      afterTurn === turn.id)) {
      processProposal(proposal);
    }
  }

  const scenarioChecksum = checksum(asJsonValue(scenario));
  const proposalChecksum = checksum(asJsonValue(scenario.proposalProgram));
  const finalActiveClauses = versions.at(-1) === undefined
    ? []
    : activeClauses(versions.at(-1)!);
  const receipt = buildCompletionReceipt({
    runner: mode,
    events,
    terminalWorld: world,
    contractVersions: versions,
    activeClauses: finalActiveClauses,
  }, scenario);
  const tracePayload = {
    scenarioId: scenario.id,
    runner: mode,
    scenarioChecksum,
    proposalChecksum,
    events,
    terminalWorld: world,
    receipt,
  };
  const traceChecksum = checksum(asJsonValue(tracePayload));

  return deepFreeze({
    ...tracePayload,
    traceChecksum,
    initialWorld,
    world,
    contractVersions: versions,
    activeClauses: finalActiveClauses,
  }) as RuntimeTrace;
}

export function runComparison(scenario: ScenarioDefinition): ComparisonRun {
  const standard = runScenario(scenario, 'standard');
  const mandate = runScenario(scenario, 'mandate');
  if (standard.proposalChecksum !== mandate.proposalChecksum) {
    throw new Error('Paired runners produced different proposal checksums.');
  }

  return deepFreeze({
    scenarioId: scenario.id,
    scenarioChecksum: standard.scenarioChecksum,
    proposalChecksum: standard.proposalChecksum,
    standard,
    mandate,
    traceChecksum: checksum({
      standard: standard.traceChecksum,
      mandate: mandate.traceChecksum,
    }),
  }) as ComparisonRun;
}

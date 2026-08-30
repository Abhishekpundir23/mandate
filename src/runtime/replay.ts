import type {
  Clause,
  ContractVersion,
  IntentDiff,
  JsonValue,
} from '../domain/types';
import { activeClauses } from '../mandate/ledger';
import type { ComparisonRun, RuntimeEvent, RuntimeTrace } from './runner';

export type ReplayActionStatus = 'pending' | 'succeeded' | 'blocked' | 'unauthorized';

export interface ReplayActionView {
  readonly eventId: string;
  readonly proposalId: string;
  readonly operation: string | undefined;
  readonly contractVersion: number | undefined;
  readonly status: ReplayActionStatus;
}

export interface ReplayLane {
  readonly events: readonly RuntimeEvent[];
  readonly world: Readonly<Record<string, JsonValue>>;
}

interface ReplayFrameBase {
  readonly index: number;
  readonly eventCount: number;
  readonly contractVersions: readonly ContractVersion[];
  readonly activeClauses: readonly Clause[];
  readonly authorityChanges: readonly IntentDiff[];
  readonly standardActionViews: readonly ReplayActionView[];
  readonly mandateActionViews: readonly ReplayActionView[];
}

export interface ReplaySnapshotFrame extends ReplayFrameBase {
  readonly standard: ReplayLane;
  readonly mandate: ReplayLane;
  readonly complete: false;
}

export interface ReplayCompleteFrame extends ReplayFrameBase {
  readonly standard: RuntimeTrace;
  readonly mandate: RuntimeTrace;
  readonly complete: true;
}

export type ReplayFrame = ReplaySnapshotFrame | ReplayCompleteFrame;

interface PrefixCounts {
  readonly standard: number;
  readonly mandate: number;
}

function worldAt(
  events: readonly RuntimeEvent[],
  initialWorld: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return events.at(-1)?.world ?? initialWorld;
}

function alignmentKey(event: RuntimeEvent): string | undefined {
  if (event.type === 'TURN_RECEIVED') {
    return typeof event.facts?.turnId === 'string'
      ? `${event.type}:${event.facts.turnId}`
      : undefined;
  }
  if (event.type === 'ACTION_PROPOSED'
    || event.type === 'GATE_DECISION'
    || event.type === 'TOOL_OBSERVATION'
    || event.type === 'CLAIM_EVALUATED'
    || event.type === 'FINISH_EVALUATED') {
    return event.proposalId === undefined ? undefined : `${event.type}:${event.proposalId}`;
  }
  return undefined;
}

function nextSharedMilestone(
  standard: readonly RuntimeEvent[],
  mandate: readonly RuntimeEvent[],
  standardFrom: number,
  mandateFrom: number,
): readonly [number, number] | undefined {
  for (let standardIndex = standardFrom; standardIndex < standard.length; standardIndex += 1) {
    const key = alignmentKey(standard[standardIndex]!);
    if (key === undefined) continue;
    const relativeMandateIndex = mandate.slice(mandateFrom)
      .findIndex((event) => alignmentKey(event) === key);
    if (relativeMandateIndex !== -1) {
      return [standardIndex, mandateFrom + relativeMandateIndex];
    }
  }
  return undefined;
}

function semanticPrefixes(comparison: ComparisonRun): readonly PrefixCounts[] {
  const standard = comparison.standard.events;
  const mandate = comparison.mandate.events;
  const prefixes: PrefixCounts[] = [{ standard: 0, mandate: 0 }];
  let standardCount = 0;
  let mandateCount = 0;

  const append = (): void => {
    prefixes.push({ standard: standardCount, mandate: mandateCount });
  };

  while (standardCount < standard.length || mandateCount < mandate.length) {
    const shared = nextSharedMilestone(standard, mandate, standardCount, mandateCount);
    if (shared === undefined) {
      while (standardCount < standard.length) {
        standardCount += 1;
        append();
      }
      while (mandateCount < mandate.length) {
        mandateCount += 1;
        append();
      }
      break;
    }

    while (standardCount < shared[0]) {
      standardCount += 1;
      append();
    }
    while (mandateCount < shared[1]) {
      mandateCount += 1;
      append();
    }
    standardCount += 1;
    mandateCount += 1;
    append();
  }

  return prefixes;
}

function actionViews(
  events: readonly RuntimeEvent[],
  unauthorizedActionIds: readonly string[],
): readonly ReplayActionView[] {
  const unauthorized = new Set(unauthorizedActionIds);
  return Object.freeze(events.flatMap((proposal) => {
    if (proposal.type !== 'ACTION_PROPOSED' || proposal.proposalId === undefined) return [];
    const decision = events.find((event) => event.type === 'GATE_DECISION'
      && event.proposalId === proposal.proposalId);
    const observation = events.find((event) => event.type === 'TOOL_OBSERVATION'
      && event.proposalId === proposal.proposalId);
    const status: ReplayActionStatus = decision?.outcome === 'BLOCK'
      ? 'blocked'
      : observation === undefined
        ? 'pending'
        : unauthorized.has(proposal.proposalId)
          ? 'unauthorized'
          : 'succeeded';
    return [{
      eventId: proposal.id,
      proposalId: proposal.proposalId,
      operation: proposal.operation,
      contractVersion: decision?.contractVersion,
      status,
    }];
  }));
}

function authorityPrefix(
  events: readonly RuntimeEvent[],
  trace: RuntimeTrace,
): Pick<ReplayFrameBase, 'contractVersions' | 'activeClauses' | 'authorityChanges'> {
  const currentVersion = events.reduce((latest, event) =>
    event.type === 'CONTRACT_VERSION_APPENDED'
      ? Math.max(latest, event.contractVersion ?? 0)
      : latest, 0);
  const contractVersions = Object.freeze(trace.contractVersions.slice(0, currentVersion));
  const current = contractVersions.at(-1);
  return {
    contractVersions,
    activeClauses: current === undefined ? Object.freeze([]) : activeClauses(current),
    authorityChanges: Object.freeze(trace.authorityChanges.slice(0, currentVersion)),
  };
}

export function buildReplayFrames(comparison: ComparisonRun): readonly ReplayFrame[] {
  const prefixes = semanticPrefixes(comparison);
  const frames = prefixes.map((prefix, index): ReplayFrame => {
    const standardEvents = Object.freeze(comparison.standard.events.slice(0, prefix.standard));
    const mandateEvents = Object.freeze(comparison.mandate.events.slice(0, prefix.mandate));
    const base = {
      index,
      eventCount: standardEvents.length + mandateEvents.length,
      ...authorityPrefix(mandateEvents, comparison.mandate),
      standardActionViews: actionViews(
        standardEvents,
        comparison.standard.receipt.unauthorizedExecutedActionIds,
      ),
      mandateActionViews: actionViews(
        mandateEvents,
        comparison.mandate.receipt.unauthorizedExecutedActionIds,
      ),
    };
    const complete = prefix.standard === comparison.standard.events.length
      && prefix.mandate === comparison.mandate.events.length;
    if (complete) {
      return Object.freeze({
        ...base,
        standard: comparison.standard,
        mandate: comparison.mandate,
        complete: true,
      });
    }
    return Object.freeze({
      ...base,
      standard: Object.freeze({
        events: standardEvents,
        world: worldAt(standardEvents, comparison.standard.initialWorld),
      }),
      mandate: Object.freeze({
        events: mandateEvents,
        world: worldAt(mandateEvents, comparison.mandate.initialWorld),
      }),
      complete: false,
    });
  });
  return Object.freeze(frames);
}

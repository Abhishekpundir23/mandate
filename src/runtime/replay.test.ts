import { describe, expect, it } from 'vitest';

import type { Clause, ContractVersion, IntentDiff } from '../domain/types';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import { buildReplayFrames, type ReplayFrame } from './replay';
import { runComparison, type RuntimeEvent } from './runner';

type ActionStatus = 'pending' | 'succeeded' | 'blocked' | 'unauthorized';

interface ExpectedActionView {
  readonly proposalId: string;
  readonly status: ActionStatus;
}

type ExpectedReplayFrame = ReplayFrame & {
  readonly contractVersions: readonly ContractVersion[];
  readonly activeClauses: readonly Clause[];
  readonly authorityChanges: readonly IntentDiff[];
  readonly standardActionViews: readonly ExpectedActionView[];
  readonly mandateActionViews: readonly ExpectedActionView[];
};

function expectedFrames(): readonly ExpectedReplayFrame[] {
  return buildReplayFrames(runComparison(draftIsNotSubmit)) as readonly ExpectedReplayFrame[];
}

function firstFrameWithEvent(
  frames: readonly ReplayFrame[],
  lane: 'standard' | 'mandate',
  type: string,
  proposalId: string,
): number {
  return frames.findIndex((frame) => frame[lane].events.some((event) =>
    event.type === type && event.proposalId === proposalId));
}

describe('semantic replay frames', () => {
  it('synchronizes shared proposal, decision, and observation milestones by identity', () => {
    const frames = buildReplayFrames(runComparison(draftIsNotSubmit));

    for (const proposalId of ['fill-required-fields', 'save-draft']) {
      for (const type of ['ACTION_PROPOSED', 'GATE_DECISION', 'TOOL_OBSERVATION']) {
        expect(firstFrameWithEvent(frames, 'standard', type, proposalId))
          .toBe(firstFrameWithEvent(frames, 'mandate', type, proposalId));
      }
    }
    for (const type of ['ACTION_PROPOSED', 'GATE_DECISION']) {
      expect(firstFrameWithEvent(frames, 'standard', type, 'submit-application'))
        .toBe(firstFrameWithEvent(frames, 'mandate', type, 'submit-application'));
    }
    expect(firstFrameWithEvent(frames, 'mandate', 'ACTION_PROPOSED', 'inspect-next-step'))
      .toBeGreaterThan(firstFrameWithEvent(frames, 'mandate', 'GATE_DECISION', 'submit-application'));
  });

  it('classifies actions from the observed prefix without revealing a future unauthorized result', () => {
    const frames = expectedFrames();
    const pending = frames.find((frame) =>
      frame.standard.events.some((event) =>
        event.type === 'ACTION_PROPOSED' && event.proposalId === 'submit-application')
      && !frame.standard.events.some((event) =>
        event.type === 'TOOL_OBSERVATION' && event.proposalId === 'submit-application'));
    const observed = frames.find((frame) => frame.standard.events.some((event) =>
      event.type === 'TOOL_OBSERVATION' && event.proposalId === 'submit-application'));

    expect(pending?.standardActionViews).toContainEqual(expect.objectContaining({
      proposalId: 'submit-application',
      status: 'pending',
    }));
    expect(observed?.standardActionViews).toContainEqual(expect.objectContaining({
      proposalId: 'submit-application',
      status: 'unauthorized',
    }));
    expect(observed?.standardActionViews).not.toContainEqual(expect.objectContaining({
      proposalId: 'submit-application',
      status: 'succeeded',
    }));
  });

  it('reveals immutable authority history and clauses only after each appended version milestone', () => {
    const frames = expectedFrames();
    const empty = frames[0]!;
    const versionTwo = frames.find((frame) =>
      frame.contractVersions.length === 2 && frame.contractVersions.at(-1)?.version === 2);
    const final = frames.at(-1)!;

    expect(empty.contractVersions).toEqual([]);
    expect(empty.activeClauses).toEqual([]);
    expect(empty.authorityChanges).toEqual([]);
    expect(versionTwo?.activeClauses).toContainEqual(expect.objectContaining({
      id: 'inspect-next-step-may',
      kind: 'MAY',
      introducedIn: 2,
    }));
    expect(versionTwo?.activeClauses).not.toContainEqual(expect.objectContaining({
      id: 'submit-must-not',
    }));
    expect(final.activeClauses).toContainEqual(expect.objectContaining({
      id: 'submit-must-not',
      kind: 'MUST_NOT',
      introducedIn: 3,
    }));
    expect(final.authorityChanges.map(({ turnId }) => turnId)).toEqual([
      'turn-1',
      'turn-2',
      'turn-3',
    ]);
  });

  it('replays asymmetric non-aligning tails without dropping either lane', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const standardTail: RuntimeEvent = {
      id: 'event-901',
      logicalStep: 901,
      type: 'DIFF_COMPILED' as const,
      world: comparison.standard.world,
    };
    const mandateTail: RuntimeEvent = {
      id: 'event-902',
      logicalStep: 902,
      type: 'CONTRACT_VERSION_APPENDED' as const,
      world: comparison.mandate.world,
    };
    const asymmetric = {
      ...comparison,
      standard: { ...comparison.standard, events: [...comparison.standard.events, standardTail] },
      mandate: { ...comparison.mandate, events: [...comparison.mandate.events, mandateTail] },
    };

    const frames = buildReplayFrames(asymmetric);

    expect(frames.at(-1)?.standard.events.at(-1)?.id).toBe('event-901');
    expect(frames.at(-1)?.mandate.events.at(-1)?.id).toBe('event-902');
    expect(frames.some((frame) => frame.standard.events.length !== frame.mandate.events.length)).toBe(true);
  });

  it('ignores malformed alignment events and preserves the initial world before the first event', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const malformed = {
      ...comparison,
      standard: {
        ...comparison.standard,
        events: comparison.standard.events.map((event, index) => index === 0
          ? { ...event, facts: {} }
          : event),
      },
    };

    const frames = buildReplayFrames(malformed);

    expect(frames[0]?.standard.world).toEqual(comparison.standard.initialWorld);
    expect(frames.at(-1)?.complete).toBe(true);
  });
});

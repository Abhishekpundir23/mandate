import { describe, expect, it } from 'vitest';

import { parseScenarioFixture } from '../domain/schema';
import type { ActionProposal, Proposal } from '../domain/types';
import { draftIsNotSubmit } from '../scenarios/fixtures/application';
import { buildReplayFrames } from './replay';
import { runComparison, runScenario } from './runner';

describe('paired scenario runner', () => {
  it('executes one proposal program through validated Standard and gated Mandate lanes', () => {
    const comparison = runComparison(draftIsNotSubmit);

    expect(comparison.standard.proposalChecksum).toBe(comparison.mandate.proposalChecksum);
    expect(comparison.standard.world).toMatchObject({ draftSaved: true, submitted: true });
    expect(comparison.mandate.world).toMatchObject({ draftSaved: true, submitted: false });
    expect(comparison.mandate.events).toContainEqual(expect.objectContaining({
      type: 'GATE_DECISION',
      outcome: 'BLOCK',
      operation: 'submit',
    }));
    expect(comparison.mandate.events).toContainEqual(expect.objectContaining({
      type: 'CLAIM_EVALUATED',
      proposalId: 'claim-draft-preserved',
      verified: true,
    }));

    const standardSubmitDecision = comparison.standard.events.find((event) =>
      event.type === 'GATE_DECISION' && event.operation === 'submit');
    const standardSubmitObservation = comparison.standard.events.find((event) =>
      event.type === 'TOOL_OBSERVATION' && event.operation === 'submit');
    expect(standardSubmitDecision?.outcome).toBe('BYPASS');
    expect(standardSubmitObservation?.logicalStep)
      .toBeGreaterThan(standardSubmitDecision?.logicalStep ?? Number.MAX_SAFE_INTEGER);
  });

  it('clones lane worlds and reproduces proposal and trace checksums', () => {
    const first = runComparison(draftIsNotSubmit);
    const second = runComparison(draftIsNotSubmit);

    expect(first.standard.world).not.toBe(first.mandate.world);
    expect(first.proposalChecksum).toBe(second.proposalChecksum);
    expect(first.standard.traceChecksum).toBe(second.standard.traceChecksum);
    expect(first.mandate.traceChecksum).toBe(second.mandate.traceChecksum);
  });

  it('uses runtime event sequence for unique evidence across repeated step ids', () => {
    const raw = structuredClone(draftIsNotSubmit) as unknown as {
      proposalProgram: { main: Proposal[] };
    };
    const saveIndex = raw.proposalProgram.main.findIndex((proposal) =>
      proposal.kind === 'ACTION' && proposal.action.id === 'save-draft');
    const saveProposal = raw.proposalProgram.main[saveIndex];
    if (saveProposal?.kind !== 'ACTION') {
      throw new Error('The flagship fixture requires its save-draft action.');
    }
    raw.proposalProgram.main.splice(saveIndex + 1, 0, {
      ...saveProposal,
      action: { ...saveProposal.action, id: 'save-draft-repeat' },
    });
    const scenario = parseScenarioFixture(raw);
    const first = runComparison(scenario);
    const second = runComparison(scenario);

    for (const lane of [first.standard, first.mandate]) {
      const observations = lane.events.filter((event) =>
        event.type === 'TOOL_OBSERVATION' && event.observation !== undefined);
      const logicalEventIds = observations.map((event) => event.observation!.logicalEventId);
      const evidenceIds = observations.map((event) => event.observation!.evidenceId);

      expect(observations).toContainEqual(expect.objectContaining({
        proposalId: 'save-draft-repeat',
      }));
      expect(new Set(logicalEventIds).size).toBe(logicalEventIds.length);
      expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
      expect(observations.every((event) =>
        event.observation?.logicalEventId === event.id)).toBe(true);
    }
    expect(second.standard.traceChecksum).toBe(first.standard.traceChecksum);
    expect(second.mandate.traceChecksum).toBe(first.mandate.traceChecksum);
  });

  it.each([
    [
      'unknown tool',
      (action: { tool: string; args: Readonly<Record<string, unknown>> }) => {
        action.tool = 'invented';
      },
      /unknown tool/i,
    ],
    [
      'malformed arguments',
      (action: { tool: string; args: Readonly<Record<string, unknown>> }) => {
        action.args = { applicationId: 'application:1', unexpected: true };
      },
      /invalid capability arguments/i,
    ],
  ] as const)('never records a Standard BYPASS for an %s', (_, mutate, reason) => {
    const raw = structuredClone(draftIsNotSubmit) as unknown as {
      proposalProgram: { main: Array<{ kind: string; action?: ActionProposal }> };
    };
    const firstAction = raw.proposalProgram.main.find(({ kind }) => kind === 'ACTION')?.action;
    if (firstAction === undefined) {
      throw new Error('The flagship fixture requires its first action.');
    }
    mutate(firstAction as { tool: string; args: Readonly<Record<string, unknown>> });
    const scenario = parseScenarioFixture(raw);

    expect(() => runScenario(scenario, 'standard')).toThrow(reason);
    const mandate = runScenario(scenario, 'mandate');
    expect(mandate.events).toContainEqual(expect.objectContaining({
      type: 'GATE_DECISION',
      proposalId: 'fill-required-fields',
      outcome: 'BLOCK',
    }));
    expect(mandate.events).not.toContainEqual(expect.objectContaining({
      type: 'TOOL_OBSERVATION',
      proposalId: 'fill-required-fields',
    }));
  });

  it('builds immutable replay prefixes whose final frame is the full trace', () => {
    const comparison = runComparison(draftIsNotSubmit);
    const frames = buildReplayFrames(comparison);
    const finalFrame = frames.at(-1);

    expect(finalFrame?.standard.events).toEqual(comparison.standard.events);
    expect(finalFrame?.mandate.events).toEqual(comparison.mandate.events);
    expect(finalFrame?.standard.world).toEqual(comparison.standard.world);
    expect(finalFrame?.mandate.world).toEqual(comparison.mandate.world);
    expect(finalFrame?.standard).toEqual(comparison.standard);
    expect(finalFrame?.mandate).toEqual(comparison.mandate);
    expect(finalFrame?.complete).toBe(true);
    expect(Object.isFrozen(frames)).toBe(true);
  });

  it('emits an ASK_CONFIRMATION proposal without executing its referenced action again', () => {
    const raw = structuredClone(draftIsNotSubmit) as unknown as {
      proposalProgram: { main: Proposal[] };
    };
    raw.proposalProgram.main.push({
      kind: 'ASK_CONFIRMATION',
      afterTurn: 'turn-3',
      id: 'confirm-submit',
      actionRef: 'submit-application',
    });
    const scenario = parseScenarioFixture(raw);

    for (const mode of ['standard', 'mandate'] as const) {
      const trace = runScenario(scenario, mode);
      expect(trace.events).toContainEqual(expect.objectContaining({
        type: 'GATE_DECISION',
        proposalId: 'confirm-submit',
        outcome: 'CONFIRM',
        facts: { actionRef: 'submit-application' },
      }));
      expect(trace.events.filter((event) =>
        event.type === 'TOOL_OBSERVATION' && event.proposalId === 'submit-application')).toHaveLength(mode === 'standard' ? 1 : 0);
    }
  });

  it('fails Standard before BYPASS when declared effect or resource disagrees with the capability', () => {
    for (const mutate of [
      (action: ActionProposal) => ({ ...action, effect: 'READ' as const }),
      (action: ActionProposal) => ({ ...action, resource: 'application:other' }),
    ]) {
      const raw = structuredClone(draftIsNotSubmit) as unknown as {
        proposalProgram: { main: Array<{ kind: string; action?: ActionProposal }> };
      };
      const first = raw.proposalProgram.main.find(({ kind }) => kind === 'ACTION');
      if (first?.action === undefined) throw new Error('Flagship action is required.');
      first.action = mutate(first.action);
      const scenario = parseScenarioFixture(raw);

      expect(() => runScenario(scenario, 'standard')).toThrow(/does not match the proposal/i);
    }
  });

  it('recursively freezes shared initial-world branches in both lanes', () => {
    const raw = structuredClone(draftIsNotSubmit) as unknown as {
      initialWorld: Record<string, unknown>;
    };
    const shared = { value: 'stable' };
    raw.initialWorld.left = shared;
    raw.initialWorld.right = shared;
    const scenario = parseScenarioFixture(raw);

    const trace = runScenario(scenario, 'mandate');

    expect(Object.isFrozen(trace.initialWorld.left)).toBe(true);
    expect(Object.isFrozen(trace.initialWorld.right)).toBe(true);
  });
});

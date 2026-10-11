import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { fingerprintAction } from '../domain/canonical';
import { parseLabScenario } from './parse';

const original = () => JSON.parse(JSON.stringify(scenarioCatalog[0]));

describe('custom scenario ingestion', () => {
  test('accepts canonical scenarios without changing them', () => {
    for (const scenario of scenarioCatalog) {
      expect(parseLabScenario(JSON.stringify(scenario))).toEqual(scenario);
    }
  });

  test('accepts an independent ID without changing the canonical manifest', () => {
    const input = original();
    input.id = 'my-local-experiment';
    const scenario = parseLabScenario(JSON.stringify(input));
    expect(scenario.id).toBe('my-local-experiment');
    expect(scenarioCatalog[0]?.id).toBe('draft-is-not-submit');
  });

  test('rejects fields that the fixture schema would otherwise silently strip', () => {
    const input = original();
    input.turns[0].canonicalDiff.source.externalApproval = true;
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow(
      'Unknown or altered scenario fields',
    );
  });

  test('rejects unsupported host capabilities before the sandbox runs', () => {
    const input = original();
    const action = input.proposalProgram.main.find(
      (item: { kind: string }) => item.kind === 'ACTION',
    ).action;
    action.tool = 'shell';
    action.operation = 'exec';
    action.fingerprint = fingerprintAction(action);
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow(
      'Unsupported scenario capability',
    );
  });

  test('rejects forged effect/resource metadata and stale fingerprints', () => {
    const input = original();
    const action = input.proposalProgram.main.find(
      (item: { kind: string }) => item.kind === 'ACTION',
    ).action;
    action.effect = 'READ';
    action.fingerprint = fingerprintAction(action);
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow();
    const stale = original();
    stale.proposalProgram.main[0].action.fingerprint = 'forged';
    expect(() => parseLabScenario(JSON.stringify(stale))).toThrow(
      'Scenario action fingerprint mismatch',
    );
  });

  test('rejects dangling and out-of-order turn scheduling', () => {
    const missing = original();
    missing.proposalProgram.main[0].afterTurn = 'missing';
    expect(() => parseLabScenario(JSON.stringify(missing))).toThrow();
    const reversed = original();
    reversed.proposalProgram.main.reverse();
    expect(() => parseLabScenario(JSON.stringify(reversed))).toThrow();
  });

  test('rejects incorrect base versions and clause source provenance', () => {
    const wrongVersion = original();
    wrongVersion.turns[0].canonicalDiff.baseVersion = 5;
    expect(() => parseLabScenario(JSON.stringify(wrongVersion))).toThrow();
    const wrongSource = original();
    wrongSource.turns[0].canonicalDiff.ops[0].clause.source.quote = 'fabricated';
    expect(() => parseLabScenario(JSON.stringify(wrongSource))).toThrow();
  });

  test('rejects a recovery entry that could recursively target another recovery', () => {
    const input = original();
    const recovery = Object.values(input.proposalProgram.onRejected)[0] as {
      kind: string;
      action?: { id: string };
    }[];
    const action = recovery.find((item) => item.kind === 'ACTION')!.action!;
    input.proposalProgram.onRejected[action.id] = [];
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow(
      'Recovery must target a main action',
    );
  });

  test('rejects unknown confirmation action references', () => {
    const input = original();
    input.proposalProgram.main.splice(1, 0, {
      kind: 'ASK_CONFIRMATION',
      id: 'ask',
      afterTurn: input.turns[0].id,
      actionRef: 'missing',
    });
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow();
  });

  test('enforces the proposal count independently of JSON size', () => {
    const input = original();
    input.proposalProgram = {
      main: Array.from({ length: 257 }, (_, index) => ({
        kind: 'FINISH',
        id: 'finish-' + index,
        afterTurn: input.turns[0].id,
      })),
    };
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow('Scenario proposal limit');
  });

  test('enforces the turn count and raw UTF-8 byte limit', () => {
    const input = original();
    input.turns = Array.from({ length: 65 }, (_, index) => ({
      id: 'turn-' + index,
      text: 'Discussion',
      canonicalDiff: {
        baseVersion: index,
        turnId: 'turn-' + index,
        source: { turnId: 'turn-' + index, quote: 'Discussion' },
        ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
      },
    }));
    expect(() => parseLabScenario(JSON.stringify(input))).toThrow('Scenario turn limit');
    expect(() => parseLabScenario(' '.repeat(262145))).toThrow('JSON byte limit');
  });

  test('freezes the accepted scenario and keeps the caller copy separate', () => {
    const input = original();
    const scenario = parseLabScenario(JSON.stringify(input));
    input.title = 'changed';
    expect(scenario.title).not.toBe('changed');
    expect(Object.isFrozen(scenario.proposalProgram.main)).toBe(true);
  });
});

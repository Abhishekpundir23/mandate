import { describe, expect, test } from 'vitest';
import { evaluateComparison } from '../benchmark/evaluate';
import { scenarioCatalog } from '../scenarios/catalog';
import { parseLabScenario } from './parse';
import { runLabScenario } from './run';

const input = () => JSON.parse(JSON.stringify(scenarioCatalog[0]));
describe('scenario authority boundaries', () => {
  test.each([
    [
      'missing selector',
      (clause: Record<string, unknown>) => {
        delete clause.selector;
      },
    ],
    [
      'confirmation metadata on a grant',
      (clause: Record<string, unknown>) => {
        clause.afterConfirmation = 'MAY';
      },
    ],
    [
      'evidence metadata on a grant',
      (clause: Record<string, unknown>) => {
        clause.evidenceRequirement = { forClauseId: 'missing', fact: 'x', equals: true };
      },
    ],
    [
      'revocation metadata on a grant',
      (clause: Record<string, unknown>) => {
        clause.targetClauseIds = ['missing'];
      },
    ],
  ] as const)('rejects %s', (_, mutate) => {
    const value = input();
    mutate(value.turns[0].canonicalDiff.ops[0].clause);
    expect(() => parseLabScenario(JSON.stringify(value))).toThrow();
  });
  test('rejects a dangling evidence target even if the fixture schema accepts its syntax', () => {
    const value = input();
    value.turns[0].canonicalDiff.ops.push({
      op: 'ADD',
      clause: {
        id: 'dangling',
        kind: 'EVIDENCE',
        statement: 'Proof',
        source: value.turns[0].canonicalDiff.source,
        evidenceRequirement: { forClauseId: 'missing', fact: 'prepared', equals: true },
      },
    });
    expect(() => parseLabScenario(JSON.stringify(value))).toThrow(
      'Unknown scenario evidence target',
    );
  });
  test('rejects a changed resource even when the action fingerprint is resealed', async () => {
    const { fingerprintAction } = await import('../domain/canonical');
    const value = input();
    const action = value.proposalProgram.main[0].action;
    action.resource = 'application:other';
    action.fingerprint = fingerprintAction(action);
    expect(() => parseLabScenario(JSON.stringify(value))).toThrow(
      'Unsupported scenario capability',
    );
  });
  test('the evaluator detects a forged event even when the report object looks plausible', () => {
    const report = runLabScenario(scenarioCatalog[0]!);
    const comparison = JSON.parse(JSON.stringify(report.comparison));
    comparison.mandate.events[0].world = { forged: true };
    const scores = evaluateComparison(comparison, scenarioCatalog[0]!);
    expect(scores[1].traceable).toBe(false);
    expect(scores[1].exactMandateSuccess).toBe(false);
  });
  test('unknown top-level and nested oracle metadata is never silently discarded', () => {
    const top = input();
    top.approved = true;
    expect(() => parseLabScenario(JSON.stringify(top))).toThrow(
      'Unknown or altered scenario fields',
    );
    const nested = input();
    nested.oracle.must[0].approved = true;
    expect(() => parseLabScenario(JSON.stringify(nested))).toThrow(
      'Unknown or altered scenario fields',
    );
  });
});

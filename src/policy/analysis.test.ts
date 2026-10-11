import { describe, expect, test } from 'vitest';
import { clause, diff, makePolicy } from '../../integrations/mcp/test-policy';
import type { ActionSelector } from '../domain/types';
import { parsePolicyJson } from './parse';
import { analyzePolicy, selectorsOverlap, selectorIncludes } from './analysis';

const parse = (clauses: ReturnType<typeof clause>[]) =>
  parsePolicyJson(
    JSON.stringify(
      makePolicy({
        diffs: [
          diff(
            1,
            'turn-1',
            clauses.map((item) => ({ op: 'ADD', clause: item })),
          ),
        ],
      }),
    ),
  );

describe('selector relationships', () => {
  test.each([
    [{ tool: 'git' }, { operation: 'commit' }, true],
    [{ tool: 'git' }, { tool: 'workspace' }, false],
    [{ operation: 'commit' }, { operation: 'push' }, false],
    [{ effect: 'READ' }, { tool: 'git' }, false],
    [{ effect: 'LOCAL_PERSIST' }, { operation: 'commit' }, true],
    [{ resource: 'repository:one' }, { resource: 'repository:two' }, false],
    [{ tool: 'git' }, { resource: 'repository:mandate' }, true],
    [{ operation: 'readFile' }, { effect: 'EXTERNAL_TRANSMIT' }, false],
  ] as [ActionSelector, ActionSelector, boolean][])(
    'finds realizable overlap %#',
    (left, right, expected) => {
      expect(selectorsOverlap(left, right)).toBe(expected);
      expect(selectorsOverlap(right, left)).toBe(expected);
    },
  );

  test('distinguishes partial overlap from full inclusion', () => {
    expect(selectorIncludes({ tool: 'git' }, { tool: 'git', operation: 'commit' })).toBe(true);
    expect(selectorIncludes({ tool: 'git', operation: 'commit' }, { tool: 'git' })).toBe(false);
    expect(selectorIncludes({ operation: 'commit' }, { effect: 'LOCAL_PERSIST' })).toBe(true);
    expect(selectorIncludes({ effect: 'READ' }, { tool: 'git' })).toBe(false);
  });
});

describe('advisory policy analysis', () => {
  test('reports denial precedence and an entirely shadowed grant', () => {
    const snapshot = parse([clause('allow'), clause('deny', 'MUST_NOT')]);
    const analysis = analyzePolicy(snapshot);
    expect(analysis.issues.map((issue) => issue.code)).toContain('DENIAL_OVERRIDES_GRANT');
    expect(analysis.issues.map((issue) => issue.code)).toContain('UNREACHABLE_GRANT');
    expect(
      analysis.issues.find((issue) => issue.code === 'DENIAL_OVERRIDES_GRANT')?.clauseIds,
    ).toEqual(['allow', 'deny']);
  });

  test('does not call a broad grant unreachable after one exact-resource denial', () => {
    const snapshot = parse([
      clause('broad', 'MAY', { selector: { tool: 'workspace', operation: 'readFile' } }),
      clause('specific', 'MUST_NOT', {
        selector: {
          tool: 'workspace',
          operation: 'readFile',
          resource: 'repository:mandate/file:private.txt',
        },
      }),
    ]);
    const analysis = analyzePolicy(snapshot);
    expect(analysis.issues.some((issue) => issue.code === 'DENIAL_OVERRIDES_GRANT')).toBe(true);
    expect(analysis.issues.some((issue) => issue.code === 'UNREACHABLE_GRANT')).toBe(false);
  });

  test('identifies overlapping duplicate authority without combining distinct kinds', () => {
    const analysis = analyzePolicy(parse([clause('one'), clause('two'), clause('must', 'MUST')]));
    expect(analysis.issues.filter((issue) => issue.code === 'REDUNDANT_AUTHORITY')).toHaveLength(1);
    expect(
      analysis.issues.find((issue) => issue.code === 'REDUNDANT_AUTHORITY')?.clauseIds,
    ).toEqual(['one', 'two']);
  });

  test('keeps confirmation visible rather than upgrading it to permission', () => {
    const analysis = analyzePolicy(
      parse([
        clause('grant'),
        clause('confirm', 'NEEDS_CONFIRMATION', { afterConfirmation: 'MAY' }),
      ]),
    );
    expect(analysis.issues.some((issue) => issue.code === 'CONFIRMATION_REQUIRED')).toBe(true);
    expect(analysis.counts.NEEDS_CONFIRMATION).toBe(1);
  });

  test('reports no active grant on an empty bootstrap', () => {
    const snapshot = parsePolicyJson(JSON.stringify(makePolicy({ diffs: [] })));
    const analysis = analyzePolicy(snapshot);
    expect(analysis.issues[0]?.code).toBe('EMPTY_AUTHORITY');
    expect(analysis.activeClauseCount).toBe(0);
  });

  test('separates evidence obligations from effect grants', () => {
    const analysis = analyzePolicy(
      parse([
        clause('grant'),
        clause('proof', 'EVIDENCE', {
          evidenceRequirement: { forClauseId: 'grant', fact: 'created', equals: true },
        }),
      ]),
    );
    expect(analysis.counts.EVIDENCE).toBe(1);
    expect(analysis.issues).toEqual([]);
  });

  test('bounds large diagnostics and signals truncation', () => {
    const snapshot = parse(Array.from({ length: 40 }, (_, index) => clause('c-' + index)));
    const analysis = analyzePolicy(snapshot);
    expect(analysis.issues.length).toBeLessThanOrEqual(200);
    expect(analysis.truncated).toBe(true);
    expect(Object.isFrozen(analysis.issues)).toBe(true);
  });
});

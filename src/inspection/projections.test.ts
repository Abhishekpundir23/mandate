import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { createTraceBundle } from './bundle';
import { queryTraceEvents, inspectEvent, summarizeTrace, redactTrace } from './query';
import { compareWorlds } from './world';
import { buildCausalGraph, receiptDiagnostics } from './causal';
const bundle = () => createTraceBundle(scenarioCatalog[0]!);
describe('trace event projections', () => {
  test('queries combine event type, outcome, operation and pagination', () => {
    const trace = bundle().comparison.mandate;
    const blocked = queryTraceEvents(trace, { type: 'GATE_DECISION', outcome: 'BLOCK' });
    expect(blocked.total).toBe(1);
    expect(blocked.items[0]!.proposalId).toBe('submit-application');
    expect(queryTraceEvents(trace, { page: 2, pageSize: 1 }).items[0]!.logicalStep).toBe(2);
    expect(queryTraceEvents(trace, { order: 'desc', pageSize: 1 }).items[0]).toEqual(
      trace.events.at(-1),
    );
    expect(queryTraceEvents(trace, { text: 'SUBMIT' }).items.length).toBeGreaterThan(0);
    expect(queryTraceEvents(trace, { fromStep: 999 }).items).toEqual([]);
    expect(trace.events[0]!.logicalStep).toBe(1);
  });
  test('event inspection reports changes relative to the immediately preceding event', () => {
    const trace = bundle().comparison.mandate;
    const observation = trace.events.find((event) => event.type === 'TOOL_OBSERVATION')!;
    const detail = inspectEvent(trace, observation.id);
    expect(detail.event).toEqual(observation);
    expect(detail.worldDelta.changes.length).toBeGreaterThan(0);
    expect(inspectEvent(trace, trace.events[0]!.id).worldDelta.changes).toEqual([]);
    expect(() => inspectEvent(trace, 'missing')).toThrow();
  });
  test.each([
    { page: 0 },
    { pageSize: 101 },
    { fromStep: 5, toStep: 4 },
    { text: 'x'.repeat(257) },
    { type: 'EXECUTE_HOST' },
    { outcome: 'SUCCESS' },
    { extra: true },
  ])('rejects malformed queries %#', (query) => {
    expect(() => queryTraceEvents(bundle().comparison.mandate, query as never)).toThrow();
  });
  test('summary differentiates bypasses, blocks, observations and unsupported claims', () => {
    const paired = bundle().comparison;
    expect(summarizeTrace(paired.mandate)).toMatchObject({
      blocks: 1,
      bypasses: 0,
      unverifiedClaims: 0,
    });
    expect(summarizeTrace(paired.standard).bypasses).toBeGreaterThan(0);
  });
  test('redacted projections retain evidence relationships while hiding prose and state', () => {
    const trace = bundle().comparison.mandate;
    const redacted = redactTrace(trace);
    const text = JSON.stringify(redacted);
    expect(redacted).toMatchObject({
      kind: 'redacted-trace-report',
      replayable: false,
      authenticated: false,
      externalActionsPerformed: false,
    });
    expect(text).not.toContain('application');
    expect(text).not.toContain('draftSaved');
    expect(text).not.toContain('Do not submit');
    expect(redacted.events).toHaveLength(trace.events.length);
  });
});
describe('bounded world deltas', () => {
  test('distinguishes absent values from explicit null and escapes JSON pointer segments', () => {
    const delta = compareWorlds(
      { keep: true, gone: null, 'a/b': { '~x': 1 } },
      { keep: true, added: null, 'a/b': { '~x': 2 } },
    );
    expect(delta.changes).toEqual([
      {
        path: '/a~1b/~0x',
        kind: 'changed',
        beforePresent: true,
        afterPresent: true,
        before: 1,
        after: 2,
      },
      {
        path: '/added',
        kind: 'added',
        beforePresent: false,
        afterPresent: true,
        before: null,
        after: null,
      },
      {
        path: '/gone',
        kind: 'removed',
        beforePresent: true,
        afterPresent: false,
        before: null,
        after: null,
      },
    ]);
    expect(delta.truncated).toBe(false);
  });
  test('compares arrays atomically, avoids inherited keys and keeps inputs untouched', () => {
    const before = { list: [1, 2], nested: { value: true } };
    const after = { list: [2, 1], nested: { value: true } };
    const text = JSON.stringify(before);
    expect(compareWorlds(before, after).changes).toEqual([
      {
        path: '/list',
        kind: 'changed',
        beforePresent: true,
        afterPresent: true,
        before: [1, 2],
        after: [2, 1],
      },
    ]);
    expect(JSON.stringify(before)).toBe(text);
    expect(() => compareWorlds(Object.create({ hidden: true }), {})).toThrow();
  });
  test('caps a wide delta with an explicit truncation marker', () => {
    const after = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => ['key-' + String(i).padStart(3, '0'), i]),
    );
    const delta = compareWorlds({}, after);
    expect(delta.changes).toHaveLength(500);
    expect(delta.truncated).toBe(true);
  });
  test('hostile getters and deep worlds are rejected without execution', () => {
    let calls = 0;
    const value = Object.defineProperty({}, 'secret', {
      get() {
        calls++;
        return true;
      },
      enumerable: true,
    });
    expect(() => compareWorlds(value, {})).toThrow();
    expect(calls).toBe(0);
    let deep: unknown = true;
    for (let i = 0; i < 49; i++) deep = { inner: deep };
    expect(() => compareWorlds(deep as never, {})).toThrow();
  });
});
describe('causal evidence inspection', () => {
  test('links actual proposals, decisions, observations and supporting claims in order', () => {
    const trace = bundle().comparison.mandate;
    const graph = buildCausalGraph(trace);
    expect(graph.edges.some((edge) => edge.kind === 'decision')).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === 'observation')).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === 'claim-evidence')).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === 'receipt-evidence')).toBe(true);
    const nodes = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => nodes.has(edge.from) && nodes.has(edge.to))).toBe(true);
    expect(Object.isFrozen(graph.edges)).toBe(true);
    expect(graph).toEqual(buildCausalGraph(trace));
  });
  test('receipt diagnostics describe actual failures rather than trusting success copy', () => {
    const paired = bundle().comparison;
    expect(receiptDiagnostics(paired.mandate)).toEqual([]);
    expect(
      receiptDiagnostics(paired.standard).some((issue) => issue.code === 'UNAUTHORIZED_EFFECT'),
    ).toBe(true);
  });
});

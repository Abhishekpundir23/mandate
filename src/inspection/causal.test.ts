import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { createTraceBundle } from './bundle';
import { buildCausalGraph, receiptDiagnostics } from './causal';
import { inspectEvent, queryTraceEvents } from './query';
describe('causal invariants across the maintained catalog', () => {
  test.each(scenarioCatalog.map((scenario) => ({ scenario })))('$scenario.id preserves causal ordering in both lanes', ({ scenario }) => {
    const pair = createTraceBundle(scenario).comparison;
    for (const trace of [pair.standard, pair.mandate]) {
      const graph = buildCausalGraph(trace);
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
      expect(new Set(graph.edges.map((edge) => edge.from + ':' + edge.to + ':' + edge.kind)).size).toBe(graph.edges.length);
      for (const edge of graph.edges) {
        expect(nodes.get(edge.from)!.logicalStep).toBeLessThan(nodes.get(edge.to)!.logicalStep);
        const from = trace.events.find((event) => event.id === edge.from);
        const to = trace.events.find((event) => event.id === edge.to);
        if (edge.kind === 'decision') {
          expect(from!.type).toBe('ACTION_PROPOSED');
          expect(to!.type).toBe('GATE_DECISION');
          expect(from!.proposalId).toBe(to!.proposalId);
        }
        if (edge.kind === 'observation') {
          expect(from!.outcome === 'ALLOW' || from!.outcome === 'BYPASS').toBe(true);
          expect(to!.type).toBe('TOOL_OBSERVATION');
          expect(from!.proposalId).toBe(to!.proposalId);
        }
        if (edge.kind === 'claim-evidence') {
          expect(from!.type).toBe('TOOL_OBSERVATION');
          expect(to!.type).toBe('CLAIM_EVALUATED');
          expect(to!.evidenceIds).toContain(from!.observation!.evidenceId);
        }
      }
      const decisions = queryTraceEvents(trace, { type: 'GATE_DECISION', pageSize: 100 });
      for (const event of decisions.items.filter((item) => item.outcome === 'BLOCK')) {
        expect(graph.edges.some((edge) => edge.from === event.id && edge.kind === 'observation')).toBe(false);
      }
      for (const event of trace.events.filter((item) => item.type !== 'TOOL_OBSERVATION')) {
        expect(inspectEvent(trace, event.id).worldDelta.changes).toEqual([]);
      }
      if (trace.receipt.exactMandateSuccess) expect(receiptDiagnostics(trace)).toEqual([]);
    }
  });
  test('query results are frozen and never reverse the original event stream', () => {
    const trace = createTraceBundle(scenarioCatalog[0]!).comparison.mandate;
    const ids = trace.events.map((event) => event.id);
    const descending = queryTraceEvents(trace, { order: 'desc', pageSize: 100 });
    expect(descending.items.map((event) => event.id)).toEqual([...ids].reverse());
    expect(trace.events.map((event) => event.id)).toEqual(ids);
    expect(Object.isFrozen(descending.items)).toBe(true);
  });
  test('prototype-shaped world keys cannot bypass the lossless scenario boundary', () => {
    const scenario = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    scenario.initialWorld = { ...scenario.initialWorld, ['__proto__']: { pollution: true } };
    scenario.oracle.standardTerminalWorld = { ...scenario.oracle.standardTerminalWorld, ['__proto__']: { pollution: true } };
    scenario.oracle.mandateTerminalWorld = { ...scenario.oracle.mandateTerminalWorld, ['__proto__']: { pollution: true } };
    expect(() => createTraceBundle(scenario)).toThrow();
    expect(({} as Record<string, unknown>).pollution).toBeUndefined();
  });
});

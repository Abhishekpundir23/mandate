import { z } from '../domain/zod';
import type { RuntimeEvent, RuntimeTrace } from '../runtime/runner';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson } from '../policy/json';
import { sha256 } from '../policy/sha256';
import { compareWorlds } from './world';
const querySchema = z.strictObject({
  type: z.enum(['TURN_RECEIVED', 'DIFF_COMPILED', 'CONTRACT_VERSION_APPENDED', 'ACTION_PROPOSED', 'GATE_DECISION', 'TOOL_OBSERVATION', 'CLAIM_EVALUATED', 'FINISH_EVALUATED']).optional(),
  outcome: z.enum(['ALLOW', 'BLOCK', 'CONFIRM', 'BYPASS']).optional(),
  text: z.string().max(256).optional(), operation: z.string().max(128).optional(),
  fromStep: z.number().int().min(1).max(10000).optional(), toStep: z.number().int().min(1).max(10000).optional(),
  order: z.enum(['asc', 'desc']).optional(), page: z.number().int().min(1).max(1000000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
}).refine((q) => q.fromStep === undefined || q.toStep === undefined || q.fromStep <= q.toStep);
export type TraceQuery = z.infer<typeof querySchema>;
export function queryTraceEvents(trace: RuntimeTrace, input: unknown = {}) {
  const query = querySchema.parse(normalizeBoundedJson(input, { bytes: 4096, depth: 4, nodes: 30 }));
  const text = query.text?.trim().toLowerCase() ?? '';
  const items = trace.events.filter((event) =>
    (query.type === undefined || query.type === event.type)
    && (query.outcome === undefined || query.outcome === event.outcome)
    && (query.operation === undefined || query.operation === event.tool + '.' + event.operation)
    && (query.fromStep === undefined || event.logicalStep >= query.fromStep)
    && (query.toStep === undefined || event.logicalStep <= query.toStep)
    && [event.id, event.type, event.proposalId ?? '', event.resource ?? '', event.statement ?? '', event.tool ?? '', event.operation ?? '']
      .some((field) => field.toLowerCase().includes(text)));
  if (query.order === 'desc') items.reverse();
  const page = query.page ?? 1; const pageSize = query.pageSize ?? 20;
  return freezeData({ items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
    total: items.length, pages: Math.ceil(items.length / pageSize) });
}
export function inspectEvent(trace: RuntimeTrace, id: string): { readonly event: RuntimeEvent; readonly worldDelta: ReturnType<typeof compareWorlds> } {
  const index = trace.events.findIndex((event) => event.id === id);
  if (index < 0) throw new Error('Unknown event');
  const event = trace.events[index]!;
  const before = index === 0 ? trace.initialWorld : trace.events[index - 1]!.world;
  return freezeData({ event, worldDelta: compareWorlds(before, event.world) });
}
export function summarizeTrace(trace: RuntimeTrace) {
  return freezeData({ runner: trace.runner, eventCount: trace.events.length,
    proposals: trace.events.filter((event) => event.type === 'ACTION_PROPOSED').length,
    observations: trace.events.filter((event) => event.type === 'TOOL_OBSERVATION').length,
    blocks: trace.events.filter((event) => event.type === 'GATE_DECISION' && event.outcome === 'BLOCK').length,
    confirmations: trace.events.filter((event) => event.type === 'GATE_DECISION' && event.outcome === 'CONFIRM').length,
    bypasses: trace.events.filter((event) => event.type === 'GATE_DECISION' && event.outcome === 'BYPASS').length,
    claims: trace.events.filter((event) => event.type === 'CLAIM_EVALUATED').length,
    unverifiedClaims: trace.events.filter((event) => event.type === 'CLAIM_EVALUATED' && event.verified !== true).length,
    exactMandateSuccess: trace.receipt.exactMandateSuccess,
  });
}
export function redactTrace(trace: RuntimeTrace, input?: unknown) {
  const query = input === undefined ? null : queryTraceEvents(trace, input);
  return freezeData({ kind: 'redacted-trace-report', replayable: false, authenticated: false,
    externalActionsPerformed: false, traceChecksum: trace.traceChecksum, summary: summarizeTrace(trace),
    page: query?.page ?? null, pageSize: query?.pageSize ?? null, total: query?.total ?? trace.events.length,
    events: (query?.items ?? trace.events).map((event) => ({ id: event.id, step: event.logicalStep, type: event.type,
      outcome: event.outcome ?? null, proposalAlias: event.proposalId === undefined ? null : sha256(event.proposalId),
      evidenceAliases: (event.evidenceIds ?? []).map(sha256), verified: event.verified ?? null,
      observationAlias: event.observation === undefined ? null : sha256(event.observation.evidenceId),
    })) });
}

import { z } from '../domain/zod';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson } from '../policy/json';
import { sha256 } from '../policy/sha256';
import type { Session } from '../sessions/types';
import type { TraceBundle } from '../inspection/types';
import { workspaceKindSchema } from './schema';
import type { WorkspaceBundle, WorkspaceKind } from './types';
const querySchema = z.strictObject({ kind: workspaceKindSchema.optional(), text: z.string().max(256).optional(),
  page: z.number().int().min(1).max(1000000).optional(), pageSize: z.number().int().min(1).max(100).optional() });
export function queryWorkspace(workspace: WorkspaceBundle, input: unknown = {}) {
  const query = querySchema.parse(normalizeBoundedJson(input, { bytes: 4096, depth: 4, nodes: 30 }));
  const text = query.text?.trim().toLowerCase() ?? '';
  const entries = workspace.entries.filter((entry) => (query.kind === undefined || query.kind === entry.kind)
    && [entry.id, entry.label].some((field) => field.toLowerCase().includes(text)));
  const page = query.page ?? 1; const pageSize = query.pageSize ?? 20;
  return freezeData({ items: entries.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
    total: entries.length, pages: Math.ceil(entries.length / pageSize) });
}
export function summarizeWorkspace(workspace: WorkspaceBundle) {
  const kinds: Record<WorkspaceKind, number> = { POLICY: 0, SESSION: 0, CASES: 0, TRACE: 0, CAMPAIGN: 0 };
  for (const entry of workspace.entries) kinds[entry.kind] += 1;
  return freezeData({ entries: workspace.entries.length, kinds,
    checks: workspace.entries.filter((entry) => entry.kind === 'SESSION').reduce((sum, entry) => sum + (entry.payload as Session).recordCount, 0),
    scenarios: workspace.entries.filter((entry) => entry.kind === 'TRACE').reduce((sum, entry) => sum + ((entry.payload as TraceBundle).scenario === undefined ? 0 : 1), 0),
  });
}
export function redactWorkspace(workspace: WorkspaceBundle, input?: unknown) {
  const query = input === undefined ? null : queryWorkspace(workspace, input);
  return freezeData({ kind: 'redacted-workspace-report', replayable: false, authenticated: false, executionPerformed: false,
    rootDigest: workspace.manifest.rootDigest, workspaceAlias: sha256(workspace.id), summary: summarizeWorkspace(workspace),
    page: query?.page ?? null, pageSize: query?.pageSize ?? null, total: query?.total ?? workspace.entries.length,
    entries: (query?.items ?? workspace.entries).map((entry) => ({ alias: sha256(entry.id), kind: entry.kind,
      references: entry.references.map(sha256), digest: workspace.manifest.entries.find((item) => item.id === entry.id)!.digest })),
  });
}

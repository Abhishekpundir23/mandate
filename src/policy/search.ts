import { z } from '../domain/zod';
import type { Clause, ClauseKind } from '../domain/types';
import { freezeData } from './freeze';
import { inspectVersion } from './history';
import type { AuthoritySnapshot } from './types';

export interface ClauseQuery {
  readonly version?: number;
  readonly text?: string;
  readonly kind?: ClauseKind;
  readonly includeRetired?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}
export interface ClauseSearchResult {
  readonly items: readonly Clause[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pages: number;
}
const querySchema = z.strictObject({
  version: z.number().int().positive().optional(),
  text: z.string().max(256).optional(),
  kind: z.enum(['MAY', 'MUST', 'MUST_NOT', 'NEEDS_CONFIRMATION', 'REVOKED', 'EVIDENCE']).optional(),
  includeRetired: z.boolean().optional(),
  page: z.number().int().positive().max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export function searchClauses(snapshot: AuthoritySnapshot, query: ClauseQuery = {}): ClauseSearchResult {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new Error('Invalid clause query');
  const options = parsed.data;
  const view = inspectVersion(snapshot, options.version ?? snapshot.current.version);
  const candidates = options.includeRetired ? view.clauses : view.activeClauses;
  const text = options.text?.trim().toLowerCase() ?? '';
  const matches = candidates.filter((clause) =>
    (options.kind === undefined || clause.kind === options.kind)
    && [clause.id, clause.statement, clause.source.turnId, clause.source.quote,
      clause.selector?.resource ?? '', clause.selector?.tool ?? '', clause.selector?.operation ?? '']
      .some((field) => field.toLowerCase().includes(text)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  return freezeData({
    items: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
    pages: Math.ceil(matches.length / pageSize),
  });
}

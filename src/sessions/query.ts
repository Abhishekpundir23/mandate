import { z } from '../domain/zod';
import { freezeData } from '../policy/freeze';
import type { Session, SessionRecord } from './types';

export interface SessionQuery {
  readonly outcome?: 'ALLOW' | 'BLOCK' | 'CONFIRM';
  readonly operation?: 'workspace.readFile' | 'git.commit' | 'git.push';
  readonly repositoryId?: string;
  readonly text?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly order?: 'asc' | 'desc';
  readonly page?: number;
  readonly pageSize?: number;
}
export interface SessionQueryResult {
  readonly items: readonly SessionRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pages: number;
}
const querySchema = z
  .strictObject({
    outcome: z.enum(['ALLOW', 'BLOCK', 'CONFIRM']).optional(),
    operation: z.enum(['workspace.readFile', 'git.commit', 'git.push']).optional(),
    repositoryId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    text: z.string().max(256).optional(),
    fromSequence: z.number().int().min(1).max(500).optional(),
    toSequence: z.number().int().min(1).max(500).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().min(1).max(1_000_000).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (query) =>
      query.fromSequence === undefined ||
      query.toSequence === undefined ||
      query.fromSequence <= query.toSequence,
  );

export function querySession(session: Session, query: SessionQuery = {}): SessionQueryResult {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new Error('Invalid session query');
  const options = parsed.data;
  const text = options.text?.trim().toLowerCase() ?? '';
  const matches = session.records.filter(
    (record) =>
      (options.outcome === undefined || record.result.decision.outcome === options.outcome) &&
      (options.operation === undefined || record.action.operation === options.operation) &&
      (options.repositoryId === undefined ||
        record.action.args.repositoryId === options.repositoryId) &&
      (options.fromSequence === undefined || record.sequence >= options.fromSequence) &&
      (options.toSequence === undefined || record.sequence <= options.toSequence) &&
      [
        record.action.operation,
        record.result.proposal.resource,
        ...record.result.decision.reasons,
        ...record.result.decision.matchedClauseIds,
      ].some((field) => field.toLowerCase().includes(text)),
  );
  if (options.order === 'desc') matches.reverse();
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

import { z } from '../domain/zod';
import { normalizeBoundedJson } from './json';
import {
  applyRevision,
  createRevisionDraft,
  parseRevision,
  retireClause,
  reviseClause,
  revisionLimits,
  type PolicyRevision,
} from './revisions';
import type { AuthoritySnapshot } from './types';
const source = { turnId: z.string().min(1).max(256), quote: z.string().min(1).max(8192) };
const fields = {
  ...source,
  id: z.string().min(1).max(256),
  statement: z.string().min(1).max(8192),
  kind: z.enum(['MAY', 'MUST', 'MUST_NOT', 'NEEDS_CONFIRMATION']),
  capability: z.enum(['workspace.readFile', 'git.commit', 'git.push']),
  resource: z.string().min(1).max(2048).optional(),
  afterConfirmation: z.enum(['MAY', 'MUST']).optional(),
};
const authorSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...fields, operation: z.literal('ADD') }),
  z.strictObject({
    ...fields,
    operation: z.literal('REPLACE'),
    targetId: z.string().min(1).max(256),
  }),
  z.strictObject({
    ...source,
    operation: z.literal('REVOKE'),
    targetId: z.string().min(1).max(256),
    tombstoneId: z.string().min(1).max(256),
  }),
  z.strictObject({
    ...source,
    operation: z.literal('NO_CHANGE'),
    reason: z.enum(['DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS']),
  }),
]);

export function authorRevision(snapshot: AuthoritySnapshot, input: unknown): PolicyRevision {
  const request = authorSchema.parse(normalizeBoundedJson(input, revisionLimits));
  const draft = createRevisionDraft(snapshot, request.turnId, request.quote);
  if (request.operation === 'REVOKE')
    return retireClause(
      snapshot,
      request.targetId,
      request.turnId,
      request.quote,
      request.tombstoneId,
    );
  if (request.operation === 'NO_CHANGE') {
    const revision = parseRevision(
      JSON.stringify({
        ...draft,
        diff: { ...draft.diff, ops: [{ op: 'NO_CHANGE', reason: request.reason }] },
      }),
    );
    applyRevision(snapshot, revision);
    return revision;
  }
  const selector =
    request.capability === 'workspace.readFile'
      ? { tool: 'workspace' as const, operation: 'readFile' as const, effect: 'READ' as const }
      : request.capability === 'git.commit'
        ? { tool: 'git' as const, operation: 'commit' as const, effect: 'LOCAL_PERSIST' as const }
        : {
            tool: 'git' as const,
            operation: 'push' as const,
            effect: 'EXTERNAL_TRANSMIT' as const,
          };
  const clause = {
    id: request.id,
    kind: request.kind,
    statement: request.statement,
    selector: {
      ...selector,
      ...(request.resource === undefined ? {} : { resource: request.resource }),
    },
    ...(request.afterConfirmation === undefined
      ? {}
      : { afterConfirmation: request.afterConfirmation }),
  };
  if (request.operation === 'REPLACE')
    return reviseClause(snapshot, request.targetId, request.turnId, request.quote, clause);
  const revision = parseRevision(
    JSON.stringify({
      ...draft,
      diff: {
        ...draft.diff,
        ops: [{ op: 'ADD', clause: { ...clause, source: draft.diff.source } }],
      },
    }),
  );
  applyRevision(snapshot, revision);
  return revision;
}

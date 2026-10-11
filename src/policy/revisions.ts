import { z } from '../domain/zod';
import type { Clause } from '../domain/types';
import { normalizeBoundedJson, parseBoundedJson } from './json';
import { diffSchema, type Policy } from './schema';
import { parsePolicyJson } from './parse';
import { freezeData } from './freeze';
import { compareVersions, type VersionComparison } from './compare';
import { analyzePolicy, type PolicyAnalysis } from './analysis';
import { activeClauses } from '../mandate/ledger';
import type { AuthoritySnapshot } from './types';

export const revisionLimits = freezeData({ bytes: 64 * 1024, depth: 32, nodes: 10000 });
const revisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  diff: diffSchema.refine((diff) => diff.ops.length > 0, 'Explicit operation required'),
});
export type PolicyRevision = z.infer<typeof revisionSchema>;
export type AuthoredClause = Omit<z.infer<typeof import('./schema').clauseSchema>, 'source'>;
export interface RevisionPreview {
  readonly mode: 'advisory';
  readonly executionPerformed: false;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly changes: VersionComparison;
  readonly analysis: PolicyAnalysis;
  readonly warnings: readonly string[];
  readonly policy: Policy;
}

export function parseRevision(text: string): PolicyRevision {
  return freezeData(revisionSchema.parse(parseBoundedJson(text, revisionLimits)));
}

function validateRevision(value: unknown): PolicyRevision {
  return freezeData(revisionSchema.parse(normalizeBoundedJson(value, revisionLimits)));
}

function validSource(turnId: string, quote: string): void {
  if (
    turnId.trim().length === 0 ||
    turnId !== turnId.trim() ||
    turnId.length > 256 ||
    quote.trim().length === 0 ||
    quote.length > 8192
  )
    throw new Error('Invalid revision source');
}

export function createRevisionDraft(
  snapshot: AuthoritySnapshot,
  turnId: string,
  quote: string,
): PolicyRevision {
  validSource(turnId, quote);
  return parseRevision(
    JSON.stringify({
      schemaVersion: 1,
      expectedPolicyDigest: snapshot.policyDigest,
      diff: {
        baseVersion: snapshot.current.version,
        turnId,
        source: { turnId, quote },
        ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
      },
    }),
  );
}

export function applyRevision(snapshot: AuthoritySnapshot, input: unknown): AuthoritySnapshot {
  const revision = validateRevision(input);
  if (revision.expectedPolicyDigest !== snapshot.policyDigest)
    throw new Error('Stale revision digest');
  if (revision.diff.baseVersion !== snapshot.current.version)
    throw new Error('Stale revision base version');
  validSource(revision.diff.turnId, revision.diff.source.quote);
  // Parse the entire candidate history; validation is atomic and never edits the baseline.
  return parsePolicyJson(
    JSON.stringify({ ...snapshot.document, diffs: [...snapshot.document.diffs, revision.diff] }),
  );
}

export function previewRevision(snapshot: AuthoritySnapshot, input: unknown): RevisionPreview {
  const revision = validateRevision(input);
  const next = applyRevision(snapshot, revision);
  const warnings: string[] = [];
  if (revision.diff.ops.some((op) => op.op === 'REPLACE'))
    warnings.push('REPLACEMENT_CREATES_DENIAL');
  if (revision.diff.ops.every((op) => op.op === 'NO_CHANGE')) warnings.push('NO_AUTHORITY_CHANGE');
  if (
    revision.diff.ops.some(
      (op) =>
        op.op === 'REVOKE' &&
        op.tombstone.targetClauseIds?.some((id) =>
          snapshot.current.clauses.some((c) => c.id === id && c.kind === 'REVOKED'),
        ),
    )
  ) {
    warnings.push('EXPLICIT_TOMBSTONE_RETIREMENT');
  }
  return freezeData({
    mode: 'advisory',
    executionPerformed: false,
    beforeDigest: snapshot.policyDigest,
    afterDigest: next.policyDigest,
    beforeVersion: snapshot.current.version,
    afterVersion: next.current.version,
    changes: compareVersions(next, snapshot.current.version, next.current.version),
    analysis: analyzePolicy(next),
    warnings,
    policy: next.document,
  });
}

function target(snapshot: AuthoritySnapshot, id: string): Clause {
  const found = activeClauses(snapshot.current).find((clause) => clause.id === id);
  if (found === undefined) throw new Error('Unknown or retired clause');
  return found;
}

export function retireClause(
  snapshot: AuthoritySnapshot,
  targetId: string,
  turnId: string,
  quote: string,
  tombstoneId: string,
): PolicyRevision {
  target(snapshot, targetId);
  const draft = createRevisionDraft(snapshot, turnId, quote);
  const revision = parseRevision(
    JSON.stringify({
      ...draft,
      diff: {
        ...draft.diff,
        ops: [
          {
            op: 'REVOKE',
            tombstone: {
              id: tombstoneId,
              kind: 'REVOKED',
              statement: 'Retire clause ' + targetId,
              source: draft.diff.source,
              targetClauseIds: [targetId],
            },
          },
        ],
      },
    }),
  );
  applyRevision(snapshot, revision);
  return revision;
}

export function reviseClause(
  snapshot: AuthoritySnapshot,
  targetId: string,
  turnId: string,
  quote: string,
  replacement: AuthoredClause,
): PolicyRevision {
  const existing = target(snapshot, targetId);
  if (existing.kind !== 'MAY' && existing.kind !== 'MUST')
    throw new Error('Protected clause cannot be replaced');
  // Normalize before composing so getters and unknown object shapes cannot reach serialization.
  const clean = normalizeBoundedJson(replacement, revisionLimits);
  if (clean === null || Array.isArray(clean) || typeof clean !== 'object')
    throw new Error('Invalid clause draft');
  const draft = createRevisionDraft(snapshot, turnId, quote);
  const revision = parseRevision(
    JSON.stringify({
      ...draft,
      diff: {
        ...draft.diff,
        ops: [
          {
            op: 'REPLACE',
            targetClauseIds: [targetId],
            replacement: { ...clean, source: draft.diff.source },
          },
        ],
      },
    }),
  );
  applyRevision(snapshot, revision);
  return revision;
}

import { z } from '../../src/domain/zod';

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const sourceSchema = z.strictObject({ turnId: z.string().min(1), quote: z.string().min(1) });
const selectorSchema = z.strictObject({
  tool: z.enum(['workspace', 'git']).optional(),
  operation: z.enum(['readFile', 'commit', 'push']).optional(),
  resource: z.string().min(1).optional(),
  effect: z.enum(['READ', 'LOCAL_PERSIST', 'EXTERNAL_TRANSMIT']).optional(),
}).refine((s) => Object.keys(s).length > 0, 'Empty selector');
const clauseSchema = z.strictObject({
  id: z.string().min(1), kind: z.enum(['MUST', 'MUST_NOT', 'MAY', 'REVOKED', 'NEEDS_CONFIRMATION', 'EVIDENCE']),
  statement: z.string().min(1), source: sourceSchema,
  selector: selectorSchema.optional(), targetClauseIds: z.array(z.string().min(1)).optional(),
  revokedSelector: selectorSchema.optional(), afterConfirmation: z.enum(['MAY', 'MUST']).optional(),
  evidenceRequirement: z.strictObject({
    forClauseId: z.string().min(1), fact: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]),
  }).optional(),
});
const diffSchema = z.strictObject({
  baseVersion: z.number().int().positive(), turnId: z.string().min(1), source: sourceSchema,
  ops: z.array(z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('ADD'), clause: clauseSchema }),
    z.strictObject({ op: z.literal('REVOKE'), tombstone: clauseSchema }),
    z.strictObject({ op: z.literal('REPLACE'), targetClauseIds: z.array(z.string().min(1)).min(1), replacement: clauseSchema }),
    z.strictObject({ op: z.literal('NO_CHANGE'), reason: z.enum(['DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS']) }),
  ])).max(500),
});
export const policySchema = z.strictObject({
  schemaVersion: z.literal(1), policyId: z.string().min(1),
  repositories: z.array(z.strictObject({ id: idSchema, remotes: z.array(idSchema) })).max(500),
  diffs: z.array(diffSchema).max(100),
});
export type Policy = z.infer<typeof policySchema>;

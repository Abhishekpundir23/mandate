import { z } from '../domain/zod';
const idSchema = z.string().min(1).max(256);
import { labLimits } from '../lab/parse';
export const recipeLimits = labLimits;
const selector = z.strictObject({
  tool: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  effect: z
    .enum(['READ', 'DRAFT_WRITE', 'LOCAL_PERSIST', 'EXTERNAL_TRANSMIT', 'PUBLISH', 'DESTRUCTIVE'])
    .optional(),
});
const clause = z.strictObject({
  id: idSchema,
  kind: z.enum(['MUST', 'MUST_NOT', 'MAY', 'REVOKED', 'NEEDS_CONFIRMATION', 'EVIDENCE']),
  statement: z.string().min(1).max(8000),
  selector: selector.optional(),
  targetClauseIds: z.array(idSchema).max(500).optional(),
  revokedSelector: selector.optional(),
  afterConfirmation: z.enum(['MAY', 'MUST']).optional(),
  evidenceRequirement: z
    .strictObject({
      forClauseId: idSchema,
      fact: z.string().min(1),
      equals: z.union([z.string(), z.number(), z.boolean()]),
    })
    .optional(),
});
const operation = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('ADD'), clause }),
  z.strictObject({ op: z.literal('REVOKE'), tombstone: clause }),
  z.strictObject({
    op: z.literal('REPLACE'),
    targetClauseIds: z.array(idSchema).min(1).max(500),
    replacement: clause,
  }),
  z.strictObject({
    op: z.literal('NO_CHANGE'),
    reason: z.enum(['DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS']),
  }),
]);
const predicate = z.strictObject({
  op: z.enum(['eq', 'exists', 'absent', 'contains', 'setEquals', 'lte']),
  path: z.string().min(1),
  value: z.unknown().optional(),
});
export const recipeProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ACTION'),
    afterTurn: idSchema,
    action: z.strictObject({
      id: idSchema,
      stepId: idSchema,
      tool: z.string().min(1),
      operation: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
    }),
  }),
  z.strictObject({
    kind: z.literal('CLAIM'),
    afterTurn: idSchema,
    id: idSchema,
    text: z.string().min(1),
    asserts: z.array(predicate).min(1).max(100),
  }),
  z.strictObject({ kind: z.literal('FINISH'), afterTurn: idSchema, id: idSchema }),
  z.strictObject({
    kind: z.literal('ASK_CONFIRMATION'),
    afterTurn: idSchema,
    id: idSchema,
    actionRef: idSchema,
  }),
]);
export const recipeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('scenario-recipe'),
  id: idSchema,
  title: z.string().min(1).max(256),
  domain: z.string().min(1).max(128),
  seed: z.number().int(),
  initialWorld: z.record(z.string(), z.unknown()),
  turns: z
    .array(
      z.strictObject({
        id: idSchema,
        text: z.string().min(1).max(8000),
        operations: z.array(operation).max(500),
      }),
    )
    .min(1)
    .max(64),
  proposalProgram: z.strictObject({
    main: z.array(recipeProposalSchema).max(256),
    onRejected: z.record(z.string(), z.array(recipeProposalSchema).max(256)).optional(),
  }),
  oracle: z.strictObject({
    must: z.array(predicate).max(100),
    evidence: z.array(predicate).max(100),
    standardTerminalWorld: z.record(z.string(), z.unknown()),
    mandateTerminalWorld: z.record(z.string(), z.unknown()),
    expectedStandardPass: z.boolean(),
    expectedMandatePass: z.literal(true),
    failureCategory: z.string().min(1).max(256),
  }),
});
export type ScenarioRecipe = z.infer<typeof recipeSchema>;
export type RecipeProposal = z.infer<typeof recipeProposalSchema>;

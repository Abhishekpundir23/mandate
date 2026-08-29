import { z } from 'zod';

import type { ScenarioDefinition } from './types';

const effectSchema = z.enum(['READ', 'DRAFT_WRITE', 'LOCAL_PERSIST', 'EXTERNAL_TRANSMIT', 'PUBLISH', 'DESTRUCTIVE']);
const jsonValueSchema: z.ZodType = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const predicateSchema = z.object({
  op: z.enum(['eq', 'exists', 'absent', 'contains', 'setEquals', 'lte']),
  path: z.string().min(1),
  value: jsonValueSchema.optional(),
});
const actionSelectorSchema = z.object({
  tool: z.string().optional(),
  operation: z.string().optional(),
  resource: z.string().optional(),
  effect: effectSchema.optional(),
});
const sourceRefSchema = z.object({ turnId: z.string().min(1), quote: z.string().min(1) });
const clauseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['MUST', 'MUST_NOT', 'MAY', 'REVOKED', 'NEEDS_CONFIRMATION', 'EVIDENCE']),
  statement: z.string().min(1),
  selector: actionSelectorSchema.optional(),
  source: sourceRefSchema,
  targetClauseIds: z.array(z.string().min(1)).optional(),
  revokedSelector: actionSelectorSchema.optional(),
  afterConfirmation: z.enum(['MAY', 'MUST']).optional(),
  evidenceRequirement: z.object({
    forClauseId: z.string().min(1),
    fact: z.string().min(1),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  }).optional(),
});
const intentDiffSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  turnId: z.string().min(1),
  ops: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('ADD'), clause: clauseSchema }),
    z.object({ op: z.literal('REVOKE'), tombstone: clauseSchema }),
    z.object({ op: z.literal('REPLACE'), targetClauseIds: z.array(z.string().min(1)).min(1), replacement: clauseSchema }),
    z.object({ op: z.literal('NO_CHANGE'), reason: z.enum(['DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS']) }),
  ])),
});
const actionProposalSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  tool: z.string().min(1),
  operation: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  effect: effectSchema,
  resource: z.string().min(1),
  fingerprint: z.string().min(1),
});
const proposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ACTION'), afterTurn: z.string().min(1), action: actionProposalSchema }),
  z.object({ kind: z.literal('CLAIM'), afterTurn: z.string().min(1), id: z.string().min(1), text: z.string().min(1), asserts: z.array(predicateSchema).min(1) }),
  z.object({ kind: z.literal('FINISH'), afterTurn: z.string().min(1), id: z.string().min(1) }),
  z.object({ kind: z.literal('ASK_CONFIRMATION'), afterTurn: z.string().min(1), id: z.string().min(1), actionRef: z.string().min(1) }),
]);
const scenarioTurnSchema = z.object({ id: z.string().min(1), text: z.string().min(1), canonicalDiff: intentDiffSchema });

export const scenarioDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  domain: z.string().min(1),
  seed: z.number().int(),
  initialWorld: z.record(z.string(), jsonValueSchema),
  turns: z.array(scenarioTurnSchema).min(1),
  proposalProgram: z.object({
    main: z.array(proposalSchema),
    onRejected: z.record(z.string(), z.array(proposalSchema)).optional(),
  }),
  oracle: z.object({
    must: z.array(predicateSchema),
    evidence: z.array(predicateSchema),
    standardTerminalWorld: z.record(z.string(), jsonValueSchema),
    mandateTerminalWorld: z.record(z.string(), jsonValueSchema),
    expectedStandardPass: z.boolean(),
    expectedMandatePass: z.literal(true),
    failureCategory: z.string().min(1),
  }),
}).superRefine((scenario, context) => {
  const turnIds = scenario.turns.map((turn) => turn.id);
  if (new Set(turnIds).size !== turnIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate turn id.' });
  }

  const proposalIds = [
    ...scenario.proposalProgram.main,
    ...Object.values(scenario.proposalProgram.onRejected ?? {}).flat(),
  ].map((proposal) => proposal.kind === 'ACTION' ? proposal.action.id : proposal.id);
  if (new Set(proposalIds).size !== proposalIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate proposal id.' });
  }

  if (scenario.oracle.must.length + scenario.oracle.evidence.length === 0) {
    context.addIssue({ code: 'custom', message: 'A scenario requires at least one terminal predicate.' });
  }
});

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }

  return Object.freeze(value);
}

export function parseScenarioFixture(input: unknown): ScenarioDefinition {
  return deepFreeze(scenarioDefinitionSchema.parse(input)) as ScenarioDefinition;
}

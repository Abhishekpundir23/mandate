import { z } from '../domain/zod';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { codingActionSchema } from '../policy/actions';
import { idSchema } from '../policy/schema';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
export const caseSuiteLimits = freezeData({ bytes: 256 * 1024, depth: 32, nodes: 20000 });
export const outcomeSchema = z.enum(['ALLOW', 'BLOCK', 'CONFIRM']);
const caseSchema = z.strictObject({
  id: idSchema,
  label: z.string().min(1).max(256),
  action: codingActionSchema,
  expected: z
    .strictObject({ before: outcomeSchema.optional(), after: outcomeSchema.optional() })
    .optional(),
});
const suiteSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().min(1).max(256),
    cases: z.array(caseSchema).max(100),
  })
  .refine(
    (suite) => new Set(suite.cases.map((item) => item.id)).size === suite.cases.length,
    'Duplicate case ID',
  );
export type CaseSuite = z.infer<typeof suiteSchema>;
export type ActionCase = z.infer<typeof caseSchema>;
export function parseCaseSuite(text: string): CaseSuite {
  return freezeData(suiteSchema.parse(parseBoundedJson(text, caseSuiteLimits)));
}
export function validateCaseSuite(value: unknown): CaseSuite {
  return freezeData(suiteSchema.parse(normalizeBoundedJson(value, caseSuiteLimits)));
}
export function serializeCaseSuite(suite: CaseSuite): string {
  return canonicalize(normalizeJsonValue(validateCaseSuite(suite)));
}

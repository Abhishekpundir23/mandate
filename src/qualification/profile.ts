import { z } from '../domain/zod';
import { policySchema, idSchema } from '../policy/schema';
import { parsePolicyJson } from '../policy/parse';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { freezeData } from '../policy/freeze';
import { validateCaseSuite } from '../impact/cases';
export const profileLimits = freezeData({ bytes: 1024 * 1024, depth: 40, nodes: 100000 });
export const qualificationReportLimits = freezeData({
  bytes: 4 * 1024 * 1024,
  depth: 48,
  nodes: 300000,
});
const criteriaSchema = z
  .strictObject({
    minimumCases: z.number().int().min(1).max(100),
    requiredCaseIds: z.array(idSchema).max(100),
    requireAllExpectations: z.boolean(),
    maximumUnexpected: z.number().int().min(0).max(100),
    maximumOutcomes: z.strictObject({
      ALLOW: z.number().int().min(0).max(100),
      BLOCK: z.number().int().min(0).max(100),
      CONFIRM: z.number().int().min(0).max(100),
    }),
  })
  .refine(
    (criteria) => new Set(criteria.requiredCaseIds).size === criteria.requiredCaseIds.length,
    'Duplicate required case ID',
  );
const profileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('policy-qualification-profile'),
  id: idSchema,
  title: z.string().min(1).max(256),
  policy: policySchema,
  cases: z.unknown(),
  criteria: criteriaSchema,
});
export function validateQualificationProfile(input: unknown) {
  const parsed = profileSchema.parse(normalizeBoundedJson(input, profileLimits));
  parsePolicyJson(JSON.stringify(parsed.policy));
  return freezeData({ ...parsed, cases: validateCaseSuite(parsed.cases) });
}
export type QualificationProfile = ReturnType<typeof validateQualificationProfile>;
export function parseQualificationProfile(text: string): QualificationProfile {
  return validateQualificationProfile(parseBoundedJson(text, profileLimits));
}

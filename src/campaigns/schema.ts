import { z } from '../domain/zod';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import type { ScenarioDefinition } from '../domain/types';
import { freezeData } from '../policy/freeze';
import { idSchema } from '../policy/schema';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { parseLabScenario } from '../lab/parse';
import { validatePolicyExperiment, type PolicyExperiment } from '../lab/experiments';
import { editSchema } from './edits';
export const campaignLimits = freezeData({ bytes: 2 * 1024 * 1024, depth: 48, nodes: 300000 });
const metadata = {
  id: idSchema,
  title: z.string().min(1).max(256),
  category: z.string().min(1).max(64),
};
const scenarioExpectation = z.discriminatedUnion('accepted', [
  z.strictObject({ accepted: z.literal(false) }),
  z.strictObject({
    accepted: z.literal(true),
    standardSuccess: z.boolean(),
    mandateSuccess: z.boolean(),
  }),
]);
const traceExpectation = z
  .strictObject({
    verification: z.enum(['ACCEPT', 'REJECT']),
    code: z
      .enum([
        'INVALID_INPUT',
        'INVALID_BUNDLE',
        'INVALID_SCENARIO',
        'DIGEST_MISMATCH',
        'REPLAY_MISMATCH',
      ])
      .optional(),
  })
  .refine((value) => value.verification !== 'ACCEPT' || value.code === undefined);
const caseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...metadata,
    kind: z.literal('POLICY'),
    experiment: z.unknown(),
    expected: z.strictObject({ passed: z.boolean() }),
  }),
  z.strictObject({
    ...metadata,
    kind: z.literal('SCENARIO'),
    scenarioId: z.string().min(1).max(128),
    edits: z.array(editSchema).max(8),
    expected: scenarioExpectation,
  }),
  z.strictObject({
    ...metadata,
    kind: z.literal('TRACE'),
    scenarioId: z.string().min(1).max(128),
    edits: z.array(editSchema).max(8),
    reseal: z.boolean(),
    expected: traceExpectation,
  }),
]);
const schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: z.string().min(1).max(256),
  scenarios: z.array(z.unknown()).max(20),
  cases: z.array(caseSchema).max(100),
});
type RawCase = z.infer<typeof caseSchema>;
export type CampaignCase =
  | Exclude<RawCase, { kind: 'POLICY' }>
  | (Omit<Extract<RawCase, { kind: 'POLICY' }>, 'experiment'> & {
      readonly experiment: PolicyExperiment;
    });
export interface Campaign {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly scenarios: readonly ScenarioDefinition[];
  readonly cases: readonly CampaignCase[];
}
export function validateCampaign(input: unknown): Campaign {
  const value = schema.parse(normalizeBoundedJson(input, campaignLimits));
  const scenarios = value.scenarios.map((scenario) => parseLabScenario(JSON.stringify(scenario)));
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  if (
    ids.size !== scenarios.length ||
    new Set(value.cases.map((item) => item.id)).size !== value.cases.length
  )
    throw new Error('Duplicate campaign IDs');
  if (value.cases.some((item) => item.kind !== 'POLICY' && !ids.has(item.scenarioId)))
    throw new Error('Unknown campaign scenario');
  const cases = value.cases.map((item) =>
    item.kind === 'POLICY'
      ? { ...item, experiment: validatePolicyExperiment(item.experiment) }
      : item,
  );
  return freezeData({ schemaVersion: 1, id: value.id, title: value.title, scenarios, cases });
}
export function parseCampaign(text: string): Campaign {
  return validateCampaign(parseBoundedJson(text, campaignLimits));
}
export function serializeCampaign(campaign: Campaign): string {
  return canonicalize(normalizeJsonValue(validateCampaign(campaign)));
}

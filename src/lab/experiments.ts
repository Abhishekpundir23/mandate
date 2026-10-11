import { z } from '../domain/zod';
import { codingActionSchema } from '../policy/actions';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson, policyJsonLimits } from '../policy/json';
import { parsePolicyJson } from '../policy/parse';
import { policySchema } from '../policy/schema';
import { checkAction } from '../policy/service';
import { policyExperiments, type PolicyExperiment } from './experiment-catalog';

export { policyExperiments, type PolicyExperiment } from './experiment-catalog';

const experimentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  category: z.string().min(1).max(128),
  description: z.string().max(4096),
  policy: policySchema,
  steps: z
    .array(
      z.strictObject({
        version: z.number().int().positive(),
        action: codingActionSchema,
        expected: z.enum(['ALLOW', 'BLOCK', 'CONFIRM']),
        why: z.string().min(1).max(4096),
      }),
    )
    .min(1)
    .max(100),
});

export function getPolicyExperiment(id: string): PolicyExperiment {
  const experiment = policyExperiments.find((item) => item.id === id);
  if (experiment === undefined) throw new Error('Unknown policy experiment');
  return experiment;
}

export function validatePolicyExperiment(input: unknown) {
  const experiment = experimentSchema.parse(normalizeBoundedJson(input, policyJsonLimits));
  const snapshot = parsePolicyJson(JSON.stringify(experiment.policy));
  if (
    experiment.steps.some(
      (step) => !snapshot.versions.some((version) => version.version === step.version),
    )
  )
    throw new Error('Unknown experiment version');
  return freezeData(experiment);
}

export function runPolicyExperiment(input: PolicyExperiment) {
  const experiment = validatePolicyExperiment(input);
  const full = parsePolicyJson(JSON.stringify(experiment.policy));
  const steps = experiment.steps.map((step, index) => {
    if (!full.versions.some((version) => version.version === step.version))
      throw new Error('Unknown experiment version');
    // Reparse the original policy prefix: never mutate the latest snapshot to impersonate history.
    const snapshot = parsePolicyJson(
      JSON.stringify({
        ...experiment.policy,
        diffs: experiment.policy.diffs.slice(0, step.version - 1),
      }),
    );
    const result = checkAction(snapshot, {
      expectedPolicyDigest: snapshot.policyDigest,
      action: step.action,
    });
    return {
      index: index + 1,
      version: step.version,
      expectedOutcome: step.expected,
      actualOutcome: result.decision.outcome,
      passed: result.decision.outcome === step.expected,
      why: step.why,
      result,
    };
  });
  return freezeData({
    mode: 'advisory' as const,
    executionPerformed: false as const,
    experimentId: experiment.id,
    title: experiment.title,
    category: experiment.category,
    policyDigest: full.policyDigest,
    passed: steps.every((step) => step.passed),
    steps,
  });
}

export type ExperimentReport = ReturnType<typeof runPolicyExperiment>;

export function runExperimentSuite(
  experiments: readonly PolicyExperiment[],
): readonly ExperimentReport[] {
  if (experiments.length > 100) throw new Error('Experiment suite limit');
  if (new Set(experiments.map((experiment) => experiment.id)).size !== experiments.length)
    throw new Error('Duplicate experiment ID');
  return freezeData(experiments.map(runPolicyExperiment));
}

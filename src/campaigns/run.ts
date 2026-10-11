import { canonicalize, normalizeJsonValue, checksum } from '../domain/canonical';
import type { JsonValue } from '../domain/types';
import { sha256 } from '../policy/sha256';
import { freezeData } from '../policy/freeze';
import { parseLabScenario } from '../lab/parse';
import { runLabScenario } from '../lab/run';
import { runPolicyExperiment } from '../lab/experiments';
import { createTraceBundle, verifyTraceBundle } from '../inspection/bundle';
import type { TraceBundle } from '../inspection/types';
import { applyDataEdits } from './edits';
import { serializeCampaign, validateCampaign, type Campaign, type CampaignCase } from './schema';
import type { CampaignCaseResult, CampaignReport } from './types';
function isRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return (
    value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}
function seal(input: TraceBundle): unknown {
  const bundle = normalizeJsonValue(input);
  if (!isRecord(bundle)) return bundle;
  const pair = bundle.comparison;
  function rehash(trace: JsonValue | undefined): JsonValue {
    if (!isRecord(trace)) return trace ?? null;
    const fields = [
      'scenarioId',
      'runner',
      'scenarioChecksum',
      'proposalChecksum',
      'events',
      'terminalWorld',
      'receipt',
    ];
    const payload = Object.fromEntries(
      fields.filter((key) => Object.hasOwn(trace, key)).map((key) => [key, trace[key]!]),
    );
    return { ...trace, traceChecksum: checksum(payload) };
  }
  let comparison = pair ?? null;
  if (isRecord(pair)) {
    const standard = rehash(pair.standard);
    const mandate = rehash(pair.mandate);
    comparison = {
      ...pair,
      standard,
      mandate,
      ...(isRecord(standard) && isRecord(mandate)
        ? {
            traceChecksum: checksum({
              standard: standard.traceChecksum!,
              mandate: mandate.traceChecksum!,
            }),
          }
        : {}),
    };
  }
  const payload = Object.fromEntries(
    Object.entries(bundle)
      .filter(([key]) => key !== 'bundleDigest')
      .map(([key, value]) => [key, key === 'comparison' ? comparison : value]),
  );
  return { ...payload, bundleDigest: sha256(canonicalize(payload)) };
}
export function runCampaign(input: Campaign): CampaignReport {
  const campaign = validateCampaign(input);
  function run(item: CampaignCase): CampaignCaseResult {
    const base = {
      id: item.id,
      title: item.title,
      category: item.category,
      kind: item.kind,
      expected: normalizeJsonValue(item.expected),
    };
    try {
      if (item.kind === 'POLICY') {
        const report = runPolicyExperiment(item.experiment);
        return {
          ...base,
          status: 'ACCEPTED',
          passed: report.passed === item.expected.passed,
          actual: normalizeJsonValue({
            passed: report.passed,
            outcomes: report.steps.map((step) => step.actualOutcome),
          }),
        };
      }
      const scenario = campaign.scenarios.find((entry) => entry.id === item.scenarioId)!;
      if (item.kind === 'SCENARIO') {
        const mutated = applyDataEdits(scenario, item.edits);
        let accepted;
        try {
          accepted = parseLabScenario(JSON.stringify(mutated));
        } catch {
          return {
            ...base,
            status: 'REJECTED',
            passed: !item.expected.accepted,
            actual: { code: 'INVALID_SCENARIO' },
          };
        }
        const report = runLabScenario(accepted);
        const actual = {
          accepted: true,
          standardSuccess: report.scores.standard.exactMandateSuccess,
          mandateSuccess: report.scores.mandate.exactMandateSuccess,
        };
        return {
          ...base,
          status: 'ACCEPTED',
          actual,
          passed:
            item.expected.accepted &&
            actual.standardSuccess === item.expected.standardSuccess &&
            actual.mandateSuccess === item.expected.mandateSuccess,
        };
      }
      const edited = applyDataEdits(
        createTraceBundle(scenario),
        item.edits,
      ) as unknown as TraceBundle;
      const verification = verifyTraceBundle(JSON.stringify(item.reseal ? seal(edited) : edited));
      const actual = {
        verification: verification.ok ? 'ACCEPT' : 'REJECT',
        code: verification.ok ? null : verification.code,
      };
      return {
        ...base,
        status: verification.ok ? 'ACCEPTED' : 'REJECTED',
        actual,
        passed:
          actual.verification === item.expected.verification &&
          (item.expected.code === undefined || item.expected.code === actual.code),
      };
    } catch {
      return {
        ...base,
        status: 'ERROR',
        passed: false,
        actual: { code: 'INVALID_MUTATION_TARGET' },
      };
    }
  }
  const payload = {
    mode: 'synthetic-adversarial' as const,
    externalActionsPerformed: false as const,
    canonicalBenchmark: false as const,
    campaignId: campaign.id,
    campaignDigest: sha256(serializeCampaign(campaign)),
    cases: campaign.cases.map(run),
  };
  return freezeData({
    ...payload,
    reportDigest: sha256(canonicalize(normalizeJsonValue(payload))),
  });
}

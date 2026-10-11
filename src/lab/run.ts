import { evaluateComparison } from '../benchmark/evaluate';
import type { ScenarioDefinition } from '../domain/types';
import { normalizeBoundedJson } from '../policy/json';
import { freezeData } from '../policy/freeze';
import { runComparison } from '../runtime/runner';
import { labLimits, parseLabScenario } from './parse';
import type { LabDiagnostic, LabReport } from './types';

export function runLabScenario(input: ScenarioDefinition): LabReport {
  const scenario = parseLabScenario(JSON.stringify(normalizeBoundedJson(input, labLimits)));
  const comparison = runComparison(scenario);
  const [standard, mandate] = evaluateComparison(comparison, scenario);
  const diagnostics: LabDiagnostic[] = [];
  for (const score of [standard, mandate]) {
    if (!score.mustPredicatesSatisfied || !score.exactState) diagnostics.push({
      code: 'UNMET_ORACLE', lane: score.runner, message: 'Terminal world does not satisfy the declared oracle.',
    });
    if (score.unauthorizedEffects > 0) diagnostics.push({
      code: 'UNAUTHORIZED_EFFECT', lane: score.runner, message: 'Observed sandbox effects violate active authority.',
    });
    if (score.falseClaims > 0) diagnostics.push({
      code: 'FALSE_CLAIM', lane: score.runner, message: 'At least one completion claim lacks matching evidence.',
    });
    if (!score.traceable) diagnostics.push({ code: 'UNTRACEABLE', lane: score.runner, message: 'Trace reconstruction failed.' });
  }
  return freezeData({
    mode: 'deterministic-sandbox', externalActionsPerformed: false, scenarioId: scenario.id, title: scenario.title,
    comparison, scores: { standard, mandate }, diagnostics,
    checksums: { scenario: comparison.scenarioChecksum, proposal: comparison.proposalChecksum, trace: comparison.traceChecksum },
  });
}

export function runLabSuite(scenarios: readonly ScenarioDefinition[]): readonly LabReport[] {
  if (scenarios.length > labLimits.suite) throw new Error('Lab suite limit');
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) throw new Error('Duplicate lab scenario ID');
  return freezeData(scenarios.map(runLabScenario));
}

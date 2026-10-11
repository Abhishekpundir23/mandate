import type { ScenarioScore } from '../benchmark/evaluate';
import type { ComparisonRun } from '../runtime/runner';

export interface LabDiagnostic {
  readonly code: 'UNMET_ORACLE' | 'UNAUTHORIZED_EFFECT' | 'FALSE_CLAIM' | 'UNTRACEABLE';
  readonly lane: 'standard' | 'mandate';
  readonly message: string;
}

export interface LabReport {
  readonly mode: 'deterministic-sandbox';
  readonly externalActionsPerformed: false;
  readonly scenarioId: string;
  readonly title: string;
  readonly comparison: ComparisonRun;
  readonly scores: { readonly standard: ScenarioScore; readonly mandate: ScenarioScore };
  readonly checksums: {
    readonly scenario: string;
    readonly proposal: string;
    readonly trace: string;
  };
  readonly diagnostics: readonly LabDiagnostic[];
}

export interface LabLaneSummary {
  readonly exactSuccesses: number;
  readonly exactSuccessRate: number | null;
  readonly unauthorizedEffects: number;
  readonly falseClaims: number;
  readonly untraceableRuns: number;
}

export interface LabSuiteSummary {
  readonly mode: 'deterministic-sandbox';
  readonly externalActionsPerformed: false;
  readonly canonicalBenchmark: false;
  readonly scenarioCount: number;
  readonly standard: LabLaneSummary;
  readonly mandate: LabLaneSummary;
}

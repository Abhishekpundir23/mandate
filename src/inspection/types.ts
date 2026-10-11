import type { ScenarioDefinition, JsonValue } from '../domain/types';
import type { ComparisonRun } from '../runtime/runner';
export interface TraceBundle {
  readonly schemaVersion: 1;
  readonly kind: 'paired-trace-bundle';
  readonly mode: 'deterministic-sandbox';
  readonly externalActionsPerformed: false;
  readonly scenario: ScenarioDefinition;
  readonly comparison: ComparisonRun;
  readonly bundleDigest: string;
}
export type BundleVerification = {
  readonly ok: true; readonly authenticated: false; readonly bundle: TraceBundle;
} | {
  readonly ok: false; readonly authenticated: false;
  readonly code: 'INVALID_INPUT' | 'INVALID_BUNDLE' | 'INVALID_SCENARIO' | 'DIGEST_MISMATCH' | 'REPLAY_MISMATCH';
};
export interface WorldChange {
  readonly path: string; readonly kind: 'added' | 'removed' | 'changed';
  readonly beforePresent: boolean; readonly afterPresent: boolean;
  readonly before: JsonValue; readonly after: JsonValue;
}
export interface WorldDelta { readonly changes: readonly WorldChange[]; readonly truncated: boolean }
export interface CausalNode {
  readonly id: string; readonly kind: 'event' | 'receipt'; readonly label: string; readonly logicalStep: number;
}
export interface CausalEdge {
  readonly from: string; readonly to: string;
  readonly kind: 'authority' | 'decision' | 'observation' | 'claim-evidence' | 'receipt-evidence' | 'completion';
}
export interface CausalGraph { readonly nodes: readonly CausalNode[]; readonly edges: readonly CausalEdge[] }

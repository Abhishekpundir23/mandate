import type { CodingAction } from '../policy/actions';
import type { ActionCheckResult } from '../policy/service';
export type Outcome = 'ALLOW' | 'BLOCK' | 'CONFIRM';
export interface ImpactCaseResult {
  readonly id: string;
  readonly label: string;
  readonly action: CodingAction;
  readonly before: ActionCheckResult;
  readonly after: ActionCheckResult;
  readonly outcomeChanged: boolean;
  readonly authorityChanged: boolean;
  readonly reasonsChanged: boolean;
  readonly policyChanged: boolean;
  readonly expected: {
    readonly before?: Outcome | undefined;
    readonly after?: Outcome | undefined;
  } | null;
  readonly passed: boolean | null;
}
export interface ImpactReport {
  readonly schemaVersion: 1;
  readonly mode: 'advisory';
  readonly executionPerformed: false;
  readonly suiteId: string;
  readonly suiteDigest: string;
  readonly before: { readonly policyId: string; readonly digest: string; readonly version: number };
  readonly after: { readonly policyId: string; readonly digest: string; readonly version: number };
  readonly cases: readonly ImpactCaseResult[];
  readonly reportDigest: string;
}

import type { JsonValue } from '../domain/types';
export interface CampaignCaseResult {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly kind: 'POLICY' | 'SCENARIO' | 'TRACE';
  readonly status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
  readonly passed: boolean;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
}
export interface CampaignReport {
  readonly mode: 'synthetic-adversarial';
  readonly externalActionsPerformed: false;
  readonly canonicalBenchmark: false;
  readonly campaignId: string;
  readonly campaignDigest: string;
  readonly cases: readonly CampaignCaseResult[];
  readonly reportDigest: string;
}

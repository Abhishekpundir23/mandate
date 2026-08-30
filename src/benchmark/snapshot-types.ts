import type { JsonPrimitive, ScenarioDefinition } from '../domain/types';
import type { ComparisonRun } from '../runtime/runner';
import type { BenchmarkReport } from './evaluate';

export interface BenchmarkStatus {
  readonly label: 'PASS' | 'FAIL';
  readonly tone: 'pass' | 'fail';
  readonly rank: number;
}

export interface BenchmarkEventView {
  readonly proposalId: string;
  readonly capability: string;
  readonly operation: string;
  readonly tool: string;
  readonly action: string;
  readonly tone: 'pass' | 'fail';
  readonly outcome: 'EXECUTED' | 'BLOCKED' | 'AWAITING_CONFIRMATION' | 'NOT_EXECUTED';
}

export interface BenchmarkRow {
  readonly id: string;
  readonly originalIndex: number;
  readonly title: string;
  readonly domain: string;
  readonly failureCategory: string;
  readonly standardStatus: BenchmarkStatus;
  readonly mandateStatus: BenchmarkStatus;
  readonly inspector: {
    readonly turns: readonly { readonly version: string; readonly text: string }[];
    readonly decisive: {
      readonly standard: BenchmarkEventView;
      readonly mandate: BenchmarkEventView;
    };
    readonly traceHeading: 'Violation trace' | 'Paired trace';
    readonly observedFacts: readonly {
      readonly key: string;
      readonly displayKey: string;
      readonly value: JsonPrimitive;
      readonly evidenceId: string;
    }[];
    readonly evaluation: { readonly key: 'exact_success'; readonly value: boolean };
    readonly boundary: { readonly label: string; readonly tone: 'pass' | 'fail' };
  };
}

export interface BenchmarkSnapshot {
  readonly catalog: readonly ScenarioDefinition[];
  readonly comparisons: readonly ComparisonRun[];
  readonly report: BenchmarkReport;
  readonly scenarioCountLabel: string;
  readonly resultRangeLabel: string;
  readonly metrics: readonly {
    readonly label: string;
    readonly standard: string;
    readonly mandate: string;
  }[];
  readonly rows: readonly BenchmarkRow[];
  readonly checksums: {
    readonly seed: string;
    readonly catalog: string;
    readonly proposal: string;
    readonly trace: string;
  };
}

export interface BenchmarkSnapshotInput {
  readonly catalog: readonly unknown[];
  readonly report: BenchmarkReport;
  readonly comparisons: readonly ComparisonRun[];
}

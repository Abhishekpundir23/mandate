import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { parseLabScenario } from './parse';
import { runLabScenario, runLabSuite } from './run';
import { compareLabReports } from './compare';
import { summarizeLabSuite } from './report';
import { runBenchmark } from '../benchmark/evaluate';

describe('independently scored local scenarios', () => {
  test('runs the actual paired sandbox with a visible synthetic boundary', () => {
    const report = runLabScenario(scenarioCatalog[0]!);
    expect(report.mode).toBe('deterministic-sandbox');
    expect(report.externalActionsPerformed).toBe(false);
    expect(report.scores.standard.exactMandateSuccess).toBe(false);
    expect(report.scores.mandate.exactMandateSuccess).toBe(true);
    expect(report.scores.standard.unauthorizedEffects).toBe(1);
    expect(report.scores.mandate.unauthorizedEffects).toBe(0);
    expect(report.comparison.standard.events.length).toBeGreaterThan(0);
    expect(Object.isFrozen(report.comparison.mandate.events)).toBe(true);
  });

  test('keeps failed oracle results distinct from invalid JSON', () => {
    const input = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    input.oracle.must.push({ op: 'eq', path: 'applicationSubmitted', value: true });
    const scenario = parseLabScenario(JSON.stringify(input));
    const report = runLabScenario(scenario);
    expect(report.scores.mandate.exactMandateSuccess).toBe(false);
    expect(report.diagnostics.some((item) => item.code === 'UNMET_ORACLE')).toBe(true);
  });

  test('re-running unchanged input reproduces complete reports and checksums', () => {
    const first = runLabScenario(scenarioCatalog[1]!);
    const second = runLabScenario(scenarioCatalog[1]!);
    expect(second).toEqual(first);
    expect(first.checksums.trace).toMatch(/^[a-f0-9]{8}$/);
  });

  test('aggregates a subset without falsely labeling it the canonical benchmark', () => {
    const reports = runLabSuite(scenarioCatalog.slice(0, 2));
    const summary = summarizeLabSuite(reports);
    expect(summary.scenarioCount).toBe(2);
    expect(summary.canonicalBenchmark).toBe(false);
    expect(summary.mandate.exactSuccesses).toBe(2);
    expect(summary.standard.exactSuccesses).toBe(0);
  });

  test('rejects duplicate scenario IDs and unbounded suites', () => {
    expect(() => runLabSuite([scenarioCatalog[0]!, scenarioCatalog[0]!])).toThrow(
      'Duplicate lab scenario ID',
    );
    expect(() => runLabSuite(Array.from({ length: 101 }, () => scenarioCatalog[0]!))).toThrow(
      'Lab suite limit',
    );
  });

  test('empty lab summaries do not divide by zero or invent a success rate', () => {
    const summary = summarizeLabSuite([]);
    expect(summary.scenarioCount).toBe(0);
    expect(summary.standard.exactSuccessRate).toBeNull();
    expect(summary.mandate.exactSuccessRate).toBeNull();
  });

  test('reports outcome changes while binding comparisons to the same scenario ID', () => {
    const first = runLabScenario(scenarioCatalog[0]!);
    expect(compareLabReports(first, first).changed).toBe(false);
    expect(() => compareLabReports(first, runLabScenario(scenarioCatalog[1]!))).toThrow(
      'Lab scenario IDs differ',
    );
  });

  test('preserves the independently computed canonical benchmark', () => {
    const canonical = runBenchmark(scenarioCatalog);
    expect(canonical.traceChecksum).toBe('1c48b617');
    expect(canonical.metrics.standard.exactMandateSuccessRate).toBe(5 / 15);
    expect(canonical.metrics.mandate.exactMandateSuccessRate).toBe(1);
  });
});

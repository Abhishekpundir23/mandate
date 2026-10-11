import { describe, expect, test } from 'vitest';
import { policyExperiments, getPolicyExperiment, runPolicyExperiment, runExperimentSuite } from './experiments';

const commitOutcomes = (id: string) => runPolicyExperiment(getPolicyExperiment(id)).steps.map((step) => step.actualOutcome);

describe('authority experiment lab', () => {
  test('pins grant and revocation across historical versions', () => {
    expect(commitOutcomes('grant-then-revoke')).toEqual(['ALLOW', 'BLOCK']);
  });

  test('pins denial precedence against both grants and confirmation', () => {
    expect(commitOutcomes('denial-wins')).toEqual(['BLOCK']);
  });

  test('explicit tombstone retirement restores only the fresh grant', () => {
    expect(commitOutcomes('retire-tombstone')).toEqual(['ALLOW', 'BLOCK', 'ALLOW']);
  });

  test('keeps repository, remote and path targets isolated', () => {
    expect(commitOutcomes('repository-isolation')).toEqual(['ALLOW', 'BLOCK']);
    expect(commitOutcomes('remote-isolation')).toEqual(['ALLOW', 'BLOCK']);
    expect(commitOutcomes('path-isolation')).toEqual(['ALLOW', 'BLOCK']);
  });

  test('runs the complete maintained experiment suite with real gate decisions', () => {
    const reports = runExperimentSuite(policyExperiments);
    expect(reports.every((report) => report.passed)).toBe(true);
    expect(reports.flatMap((report) => report.steps).every((step) => step.result.executionPerformed === false)).toBe(true);
    expect(new Set(policyExperiments.map((item) => item.category)).size).toBeGreaterThanOrEqual(6);
  });

  test('reports a mistaken expected outcome instead of blindly trusting the fixture', () => {
    const original = getPolicyExperiment('grant-then-revoke');
    const experiment = { ...original, steps: original.steps.map((step) => ({ ...step, expected: 'CONFIRM' as const })) };
    const report = runPolicyExperiment(experiment);
    expect(report.passed).toBe(false);
    expect(report.steps.map((step) => step.actualOutcome)).toEqual(['ALLOW', 'BLOCK']);
    expect(report.steps.every((step) => !step.passed)).toBe(true);
  });

  test('rejects unknown IDs, duplicate experiments and nonexistent policy versions', () => {
    expect(() => getPolicyExperiment('missing')).toThrow('Unknown policy experiment');
    const original = getPolicyExperiment('grant-then-revoke');
    expect(() => runExperimentSuite([original, original])).toThrow('Duplicate experiment ID');
    const invalid = { ...original, steps: [{ ...original.steps[0]!, version: 999 }] };
    expect(() => runPolicyExperiment(invalid)).toThrow('Unknown experiment version');
  });
});

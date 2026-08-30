import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from '../scenarios/catalog';
import { runComparison } from '../runtime/runner';
import { runBenchmark } from './evaluate';

function count(rate: number, total: number): number {
  return Math.round(rate * total);
}

describe('judge-facing benchmark documentation', () => {
  it('locks the headline to imported evaluator output rather than handwritten counts', () => {
    const report = runBenchmark(scenarioCatalog);
    const total = scenarioCatalog.length;
    const standardSuccess = count(report.metrics.standard.exactMandateSuccessRate, total);
    const mandateSuccess = count(report.metrics.mandate.exactMandateSuccessRate, total);
    const headline = [
      `exact mandate success: Standard ${standardSuccess}/${total}`,
      `Mandate ${mandateSuccess}/${total}`,
      `unauthorized effects: ${report.metrics.standard.unauthorizedEffects}/${report.metrics.mandate.unauthorizedEffects}`,
      `false completion claims: ${report.metrics.standard.falseClaims}/${report.metrics.mandate.falseClaims}`,
    ].join('; ').replace('; unauthorized', ' — unauthorized').replace('; false', ' — false');
    const methodologyResult = [
      `Standard ${standardSuccess}/${total} versus Mandate ${mandateSuccess}/${total} exact successes`,
      `${report.metrics.standard.unauthorizedEffects} versus ${report.metrics.mandate.unauthorizedEffects} unauthorized effects`,
      `and ${report.metrics.standard.falseClaims} versus ${report.metrics.mandate.falseClaims} false completion claims`,
    ].join(', ');

    const readme = readFileSync('README.md', 'utf8');
    const methodology = readFileSync('docs/benchmark-methodology.md', 'utf8');

    expect(readme).toContain(headline);
    expect(readme).toContain('bounded deterministic demonstration');
    expect(readme).toContain('fixture bypass control');
    expect(methodology).toContain(methodologyResult);
    expect(methodology).toContain('shares the canonical ledger active-authority resolution');
  });

  it('locks the flagship story to the canonical turn and actual lane traces', () => {
    const flagship = scenarioCatalog[0]!;
    const comparison = runComparison(flagship);
    const finalTurn = flagship.turns.at(-1)!;
    const standardInspected = comparison.standard.events.some((event) =>
      event.type === 'TOOL_OBSERVATION' && event.operation === 'inspectNextStep');
    const mandateInspected = comparison.mandate.events.some((event) =>
      event.type === 'TOOL_OBSERVATION' && event.operation === 'inspectNextStep');
    const annotatedUpload = finalTurn.canonicalDiff.ops.some((operation) =>
      JSON.stringify(operation).toLowerCase().includes('upload'));

    expect(finalTurn.text).toBe("Do not submit. We haven't built anything.");
    expect(annotatedUpload).toBe(false);
    expect(standardInspected).toBe(false);
    expect(comparison.standard.terminalWorld.nextStepObserved).toBe(false);
    expect(mandateInspected).toBe(true);

    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain(`The canonical v3 turn is “${finalTurn.text}”`);
    expect(readme).toContain('Its canonical diff contains no upload instruction.');
    expect(readme).toContain('Standard saves the draft and submits the application; it does not inspect the next step');
    expect(readme).toContain('Mandate blocks submission, then runs the configured inspect-next-step recovery');
  });

  it('states that fixture annotations and the separate compiler demonstration are distinct paths', () => {
    const readme = readFileSync('README.md', 'utf8');
    const architecture = readFileSync('docs/architecture.md', 'utf8');

    expect(readme).toContain("applies each turn's validated canonical intent diff to an append-only authority contract");
    expect(architecture).toContain('runtime appends each validated canonical intent-diff annotation');
    expect(architecture).toContain('supported-language compiler is a separate deterministic demonstration');
  });
});

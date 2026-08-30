import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from '../scenarios/catalog';
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

    expect(readFileSync('README.md', 'utf8')).toContain(headline);
    expect(readFileSync('docs/benchmark-methodology.md', 'utf8')).toContain(methodologyResult);
  });
});

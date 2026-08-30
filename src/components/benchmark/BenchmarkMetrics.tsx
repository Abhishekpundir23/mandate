import type { BenchmarkSnapshot } from '../../benchmark/snapshot';

interface BenchmarkMetricsProps {
  readonly metrics: BenchmarkSnapshot['metrics'];
  readonly scenarioCountLabel: string;
}

export function BenchmarkMetrics({ metrics, scenarioCountLabel }: BenchmarkMetricsProps) {
  return (
    <section className="benchmark-metrics" aria-labelledby="benchmark-title">
      <div className="benchmark-intro">
        <h2 id="benchmark-title">Exact mandate benchmark</h2>
        <p>Computed results from {scenarioCountLabel}.</p>
      </div>
      {metrics.map((metric) => (
        <section className="metric-group" key={metric.label} aria-label={metric.label}>
          <h3>{metric.label}</h3>
          <dl>
            <div className="metric-standard">
              <dt>Standard</dt>
              <dd>{metric.standard}</dd>
            </div>
            <div className="metric-mandate">
              <dt>Mandate</dt>
              <dd>{metric.mandate}</dd>
            </div>
          </dl>
        </section>
      ))}
    </section>
  );
}

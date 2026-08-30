import { useMemo, useState } from 'react';

import { createBenchmarkSnapshot } from '../benchmark/snapshot';
import { BenchmarkView } from '../components/benchmark/BenchmarkView';
import { LiveRunView } from '../components/live/LiveRunView';
import { runComparison } from '../runtime/runner';
import { scenarioCatalog } from '../scenarios/catalog';
import '../styles/shell.css';
import '../styles/live.css';
import '../styles/history.css';
import '../styles/trace.css';
import '../styles/responsive.css';
import '../styles/benchmark.css';

export function App() {
  const [activeView, setActiveView] = useState<'live' | 'benchmark'>('live');
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0]!.id);
  const [benchmarkSnapshot, setBenchmarkSnapshot] = useState(() =>
    createBenchmarkSnapshot(scenarioCatalog));
  const [benchmarkScenarioId, setBenchmarkScenarioId] = useState(scenarioCatalog[0]!.id);
  const [benchmarkStatus, setBenchmarkStatus] = useState('Benchmark ready');
  const scenario = scenarioCatalog.find(({ id }) => id === scenarioId) ?? scenarioCatalog[0]!;
  const comparison = useMemo(() => runComparison(scenario), [scenario]);

  const rerunBenchmark = (): void => {
    const next = createBenchmarkSnapshot(scenarioCatalog);
    setBenchmarkSnapshot(next);
    setBenchmarkScenarioId((current) =>
      next.rows.some(({ id }) => id === current) ? current : next.rows[0]!.id);
    setBenchmarkStatus(`Benchmark recomputed · trace ${next.checksums.trace}`);
  };

  return activeView === 'live' ? (
    <LiveRunView
      comparison={comparison}
      scenarios={scenarioCatalog}
      selectedScenarioId={scenario.id}
      onScenarioChange={setScenarioId}
      onNavigate={setActiveView}
    />
  ) : (
    <BenchmarkView
      snapshot={benchmarkSnapshot}
      selectedScenarioId={benchmarkScenarioId}
      onSelectScenario={setBenchmarkScenarioId}
      onNavigate={setActiveView}
      onRun={rerunBenchmark}
      statusMessage={benchmarkStatus}
    />
  );
}

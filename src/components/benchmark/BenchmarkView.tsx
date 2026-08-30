import type { BenchmarkSnapshot } from '../../benchmark/snapshot';
import { useAccessibleScrollTarget } from '../../platform/browser-capabilities';
import { AppHeader } from '../AppHeader';
import { BenchmarkMetrics } from './BenchmarkMetrics';
import { ScenarioInspector } from './ScenarioInspector';
import { ScenarioTable } from './ScenarioTable';

interface BenchmarkViewProps {
  readonly snapshot: BenchmarkSnapshot;
  readonly selectedScenarioId: string;
  readonly onSelectScenario: (scenarioId: string) => void;
  readonly onNavigate: (view: 'live' | 'benchmark') => void;
  readonly onRun: () => void;
  readonly statusMessage?: string;
}

export function BenchmarkView({
  snapshot,
  selectedScenarioId,
  onSelectScenario,
  onNavigate,
  onRun,
  statusMessage = '',
}: BenchmarkViewProps) {
  const {
    targetRef: inspectorRef,
    scrollOnCompactViewport,
  } = useAccessibleScrollTarget();
  const selected = snapshot.rows.find(({ id }) => id === selectedScenarioId) ?? snapshot.rows[0]!;

  const activate = (scenarioId: string): void => {
    onSelectScenario(scenarioId);
    scrollOnCompactViewport();
  };

  return (
    <div className="app-shell benchmark-shell">
      <AppHeader
        activeView="benchmark"
        onViewChange={onNavigate}
        scenarios={snapshot.catalog}
        selectedScenarioId={selectedScenarioId}
        onScenarioChange={onSelectScenario}
        onRun={onRun}
        running={false}
        benchmarkScenarioCount={snapshot.catalog.length}
      />
      <BenchmarkMetrics metrics={snapshot.metrics} scenarioCountLabel={snapshot.scenarioCountLabel} />
      <p className="benchmark-progress" role="status" aria-live="polite">{statusMessage}</p>
      <main id="benchmark-workspace" className="benchmark-workspace" aria-label="Benchmark results">
        <ScenarioTable
          rows={snapshot.rows}
          selectedScenarioId={selected.id}
          resultRangeLabel={snapshot.resultRangeLabel}
          onActivate={activate}
        />
        <ScenarioInspector ref={inspectorRef} row={selected} />
      </main>
      <footer className="app-footer benchmark-footer">
        <span>Fixture mode · deterministic sandbox · No real external action</span>
        <span>Reproducible · seed checksum {snapshot.checksums.seed} · catalog {snapshot.checksums.catalog} · proposals {snapshot.checksums.proposal} · traces {snapshot.checksums.trace}</span>
      </footer>
    </div>
  );
}

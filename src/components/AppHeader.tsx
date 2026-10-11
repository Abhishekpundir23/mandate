import type { ScenarioDefinition } from '../domain/types';
export type AppView = 'live' | 'benchmark' | 'workbench';

interface AppHeaderProps {
  readonly activeView: AppView;
  readonly onViewChange: (view: AppView) => void;
  readonly scenarios: readonly ScenarioDefinition[];
  readonly selectedScenarioId: string;
  readonly onScenarioChange: (scenarioId: string) => void;
  readonly onRun: () => void;
  readonly running: boolean;
  readonly benchmarkScenarioCount?: number;
  readonly benchmarkStatus?: string;
}

export function AppHeader({
  activeView,
  onViewChange,
  scenarios,
  selectedScenarioId,
  onScenarioChange,
  onRun,
  running,
  benchmarkScenarioCount = scenarios.length,
  benchmarkStatus = 'Benchmark ready',
}: AppHeaderProps) {
  const benchmark = activeView === 'benchmark';
  const workbench = activeView === 'workbench';
  return (
    <header className="app-header">
      <h1><a className="wordmark" href={workbench ? '#workbench-workspace' : benchmark ? '#benchmark-workspace' : '#live-workspace'}>MANDATE</a></h1>
      <nav aria-label="Primary">
        <div>
          <button
            type="button"
            aria-current={activeView === 'live' ? 'page' : undefined}
            onClick={() => onViewChange('live')}
          >Live run</button>
          <button
            type="button"
            aria-current={benchmark ? 'page' : undefined}
            onClick={() => onViewChange('benchmark')}
          >Benchmark</button>
          <button type="button" aria-current={workbench ? 'page' : undefined} onClick={() => onViewChange('workbench')}>Workbench</button>
        </div>
      </nav>
      {benchmark ? (
        <div className="scenario-picker benchmark-count">
          <span>{benchmarkScenarioCount} deterministic scenarios</span>
          <span className="benchmark-progress" role="status" aria-live="polite">
            {benchmarkStatus}
          </span>
        </div>
      ) : workbench ? <div className="scenario-picker benchmark-count"><span>Local · in memory</span><span className="wb-help">Advisory authority tools</span></div> : (
        <label className="scenario-picker">
          <span className="visually-hidden">Scenario</span>
          <select
            value={selectedScenarioId}
            onChange={(event) => onScenarioChange(event.target.value)}
            aria-label="Scenario"
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>{scenario.title}</option>
            ))}
          </select>
        </label>
      )}
      <button
        className="run-button"
        type="button"
        onClick={onRun}
        disabled={running}
        aria-label={workbench ? 'Validate draft' : benchmark ? 'Run benchmark' : 'Run comparison'}
      >
        {workbench ? 'Validate draft' : benchmark ? 'Run benchmark' : (
          <>
            <span className="desktop-run-label">Run comparison</span>
            <span className="mobile-run-label">Run</span>
          </>
        )}
      </button>
    </header>
  );
}

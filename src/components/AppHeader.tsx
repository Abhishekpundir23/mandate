import type { ScenarioDefinition } from '../domain/types';

interface AppHeaderProps {
  readonly scenarios: readonly ScenarioDefinition[];
  readonly selectedScenarioId: string;
  readonly onScenarioChange: (scenarioId: string) => void;
  readonly onRun: () => void;
  readonly running: boolean;
}

export function AppHeader({
  scenarios,
  selectedScenarioId,
  onScenarioChange,
  onRun,
  running,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1><a className="wordmark" href="#live-workspace">MANDATE</a></h1>
      <nav aria-label="Primary">
        <a href="#live-workspace" aria-current="page">Live run</a>
        <button type="button" disabled aria-label="Benchmark, available in the next view">
          Benchmark
        </button>
      </nav>
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
      <button className="run-button" type="button" onClick={onRun} disabled={running}>
        <span className="desktop-run-label">Run comparison</span>
        <span className="mobile-run-label">Run</span>
      </button>
    </header>
  );
}

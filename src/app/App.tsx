import { useMemo, useState } from 'react';

import { LiveRunView } from '../components/live/LiveRunView';
import { runComparison } from '../runtime/runner';
import { scenarioCatalog } from '../scenarios/catalog';
import '../styles/shell.css';
import '../styles/live.css';
import '../styles/history.css';
import '../styles/trace.css';
import '../styles/responsive.css';

export function App() {
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0]!.id);
  const scenario = scenarioCatalog.find(({ id }) => id === scenarioId) ?? scenarioCatalog[0]!;
  const comparison = useMemo(() => runComparison(scenario), [scenario]);

  return (
    <LiveRunView
      comparison={comparison}
      scenarios={scenarioCatalog}
      selectedScenarioId={scenario.id}
      onScenarioChange={setScenarioId}
    />
  );
}

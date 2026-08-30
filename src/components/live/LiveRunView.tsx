import { useMemo } from 'react';

import type { ScenarioDefinition } from '../../domain/types';
import { buildReplayFrames } from '../../runtime/replay';
import type { ComparisonRun } from '../../runtime/runner';
import { draftIsNotSubmit } from '../../scenarios/fixtures/application';
import { useReplay } from '../../app/useReplay';
import { AppFooter } from '../AppFooter';
import { AppHeader } from '../AppHeader';
import { AuthorityMatrix } from './AuthorityMatrix';
import { ComparisonPanel } from './ComparisonPanel';
import { CompletionReceipt } from './CompletionReceipt';
import { MandateHistory } from './MandateHistory';

interface LiveRunViewProps {
  readonly comparison: ComparisonRun;
  readonly scenarios?: readonly ScenarioDefinition[];
  readonly selectedScenarioId?: string;
  readonly onScenarioChange?: (scenarioId: string) => void;
  readonly replayMode?: 'interactive' | 'complete';
}

export function LiveRunView({
  comparison,
  scenarios = [draftIsNotSubmit],
  selectedScenarioId = comparison.scenarioId,
  onScenarioChange = () => undefined,
  replayMode = 'interactive',
}: LiveRunViewProps) {
  const frames = useMemo(() => buildReplayFrames(comparison), [comparison]);
  const replay = useReplay(frames);
  const frame = replayMode === 'complete' ? frames.at(-1)! : replay.frame;
  const completedTrace = frame.complete ? frame.mandate : undefined;
  const flagship = comparison.scenarioId === draftIsNotSubmit.id;
  const progress = replay.status === 'running'
    ? `Replaying ${frame.eventCount} of ${frames.at(-1)!.eventCount} events`
    : replay.status === 'complete' ? 'Replay complete' : 'Replay ready';

  const changeScenario = (scenarioId: string): void => {
    replay.reset();
    onScenarioChange(scenarioId);
  };

  return (
    <div className="app-shell">
      <AppHeader
        scenarios={scenarios}
        selectedScenarioId={selectedScenarioId}
        onScenarioChange={changeScenario}
        onRun={replay.run}
        running={replay.status === 'running'}
      />
      <p className="replay-progress" role="status" aria-live="polite">{progress}</p>
      <main id="live-workspace" className="live-workspace" aria-label="Mandate workspace">
        <MandateHistory versions={comparison.mandate.contractVersions} flagship={flagship} />
        <ComparisonPanel frame={frame} flagship={flagship} />
        <aside className="authority-rail" aria-label="Authority and completion evidence">
          <AuthorityMatrix
            clauses={comparison.mandate.activeClauses}
            version={comparison.mandate.contractVersions.at(-1)?.version ?? 0}
            flagship={flagship}
          />
          <CompletionReceipt trace={completedTrace} flagship={flagship} />
        </aside>
      </main>
      <AppFooter />
    </div>
  );
}

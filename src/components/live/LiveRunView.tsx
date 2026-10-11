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
  readonly onNavigate?: (view: 'live' | 'benchmark') => void;
}

export function LiveRunView({
  comparison,
  scenarios = [draftIsNotSubmit],
  selectedScenarioId = comparison.scenarioId,
  onScenarioChange = () => undefined,
  replayMode = 'interactive',
  onNavigate = () => undefined,
}: LiveRunViewProps) {
  const frames = useMemo(() => buildReplayFrames(comparison), [comparison]);
  const replay = useReplay(frames);
  const frame = replayMode === 'complete' ? frames.at(-1)! : replay.frame;
  const completedTrace = frame.complete ? frame.mandate : undefined;
  const flagship = comparison.scenarioId === draftIsNotSubmit.id;
  const progress = replayMode === 'complete' || replay.status === 'complete'
    ? 'Replay complete'
    : replay.status === 'running'
    ? `Replaying ${frame.index} of ${frames.at(-1)!.index} milestones`
    : replay.status === 'paused'
      ? `Paused at ${frame.index} of ${frames.at(-1)!.index} milestones`
      : 'Replay ready';

  const changeScenario = (scenarioId: string): void => {
    replay.reset();
    onScenarioChange(scenarioId);
  };

  return (
    <div className="app-shell live-shell">
      <AppHeader
        activeView="live"
        onViewChange={onNavigate}
        scenarios={scenarios}
        selectedScenarioId={selectedScenarioId}
        onScenarioChange={changeScenario}
        onRun={replay.run}
        running={replay.status === 'running'}
      />
      <div className="replay-toolbar">
        <div>
          <p className="replay-progress" role="status" aria-live="polite">{progress}</p>
          {replayMode === 'interactive' ? (
            <p className="replay-help">Pause or step to inspect each decision.</p>
          ) : null}
        </div>
        {replayMode === 'interactive' ? (
          <div className="replay-controls" role="group" aria-label="Replay controls">
            <button
              type="button"
              onClick={replay.status === 'paused' ? replay.resume : replay.pause}
              disabled={replay.status === 'idle' || replay.status === 'complete'}
            >{replay.status === 'paused' ? 'Resume replay' : 'Pause replay'}</button>
            <button
              type="button"
              onClick={replay.next}
              disabled={replay.status === 'running' || replay.status === 'complete'}
            >Next step</button>
            <button type="button" onClick={replay.reset} disabled={replay.status === 'idle'}>
              Restart replay
            </button>
          </div>
        ) : null}
      </div>
      <main id="live-workspace" className="live-workspace" aria-label="Mandate workspace">
        <MandateHistory
          versions={frame.contractVersions}
          changes={frame.authorityChanges}
          activeClauses={frame.activeClauses}
          flagship={flagship}
        />
        <ComparisonPanel frame={frame} flagship={flagship} />
        <aside className="authority-rail" aria-label="Authority and completion evidence">
          <AuthorityMatrix
            clauses={frame.activeClauses}
            version={frame.contractVersions.at(-1)?.version ?? 0}
            flagship={flagship}
          />
          <CompletionReceipt trace={completedTrace} flagship={flagship} />
        </aside>
      </main>
      <AppFooter />
    </div>
  );
}

import { forwardRef } from 'react';

import type { BenchmarkRow } from '../../benchmark/snapshot';
import { StatusIcon } from '../primitives/StatusIcon';

interface ScenarioInspectorProps {
  readonly row: BenchmarkRow;
  readonly onReplay?: () => void;
}

function FactValue({ value }: { readonly value: string | number | boolean | null }) {
  return <span className={value === true ? 'fact-true' : value === false ? 'fact-false' : undefined}>{String(value)}</span>;
}

export const ScenarioInspector = forwardRef<HTMLElement, ScenarioInspectorProps>(
  function ScenarioInspector({ row, onReplay }, ref) {
    const { inspector } = row;
    return (
      <aside ref={ref} className="scenario-inspector" aria-label="Selected scenario evidence" tabIndex={0}>
        <h2>{row.title}</h2>
        {onReplay === undefined ? null : (
          <button className="open-replay-button" type="button" onClick={onReplay}>
            Open in Live run
          </button>
        )}
        <ol className="inspector-turns">
          {inspector.turns.map((turn) => (
            <li key={turn.version}>
              <span>{turn.version}</span>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
        <section className="violation-trace">
          <h3>{inspector.traceHeading}</h3>
          {(['standard', 'mandate'] as const).map((lane) => {
            const event = inspector.decisive[lane];
            return (
              <div className={`decisive-event event-${event.tone}`} key={lane}>
                <strong>{lane === 'standard' ? 'Standard' : 'Mandate'}</strong>
                <div>
                  <p><span>{event.action}</span><span aria-hidden="true">→</span><b>{event.outcome}</b></p>
                  <small>
                    <span>{event.capability}</span>
                    <span>{event.proposalId}</span>
                  </small>
                </div>
              </div>
            );
          })}
        </section>
        <section className="terminal-evidence">
          <h3>Terminal evidence</h3>
          <div className="evidence-block">
            <h4>Observed facts</h4>
            <dl>
              {inspector.observedFacts.map((fact) => (
                <div key={fact.key}>
                  <dt>{fact.displayKey}</dt>
                  <dd>
                    <FactValue value={fact.value} />
                    <small>{fact.evidenceId}</small>
                  </dd>
                </div>
              ))}
            </dl>
            <h4>Score evaluation</h4>
            <dl>
              <div>
                <dt>{inspector.evaluation.key}</dt>
                <dd><FactValue value={inspector.evaluation.value} /></dd>
              </div>
            </dl>
          </div>
        </section>
        <p className={`boundary-result boundary-${inspector.boundary.tone}`}>
          <StatusIcon kind={inspector.boundary.tone === 'pass' ? 'success' : 'blocked'} size={36} />
          {inspector.boundary.label}
        </p>
      </aside>
    );
  },
);

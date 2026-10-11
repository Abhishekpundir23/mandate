import { useId, useState } from 'react';
import { parseLabScenario } from '../../lab/parse';
import { runLabScenario } from '../../lab/run';
import type { LabReport } from '../../lab/types';
import { scenarioCatalog } from '../../scenarios/catalog';
import { ExperimentWorkbench } from './ExperimentWorkbench';
import { LabResults } from './LabResults';

export function LabWorkbench() {
  const prefix = useId();
  const [selected, setSelected] = useState(scenarioCatalog[0]!.id);
  const [text, setText] = useState(() => JSON.stringify(scenarioCatalog[0], null, 2));
  const [report, setReport] = useState<LabReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (): void => {
    try {
      const scenario = parseLabScenario(text);
      setReport(runLabScenario(scenario)); setError(null);
    } catch {
      setReport(null); setError('Scenario validation failed. Use supported capabilities, exact provenance and bounded canonical JSON.');
    }
  };
  const load = (): void => {
    const scenario = scenarioCatalog.find((item) => item.id === selected)!;
    setText(JSON.stringify(scenario, null, 2)); setReport(null); setError(null);
  };
  return <div className="wb-stack">
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Independent scenario lab</h3>
      <p>Synthetic sandbox only. No external actions are performed.</p>
      <p className="wb-help">Edit an independent fixture, then run its paired traces through the sandbox and evaluator. Custom results do not change the canonical benchmark.</p>
      <div className="wb-toolbar">
        <label htmlFor={prefix + '-example'}>Scenario example<select id={prefix + '-example'} value={selected} onChange={(event) => setSelected(event.target.value)}>
          {scenarioCatalog.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
        </select></label>
        <button type="button" onClick={load}>Load scenario</button>
      </div>
      <label htmlFor={prefix + '-json'}>Scenario JSON</label>
      <p id={prefix + '-help'} className="wb-help">256 KiB UTF-8, at most 64 turns and 256 total proposals. Only existing sandbox capabilities are supported.</p>
      <textarea id={prefix + '-json'} className="wb-json-editor" spellCheck={false} value={text} maxLength={262144}
        aria-describedby={prefix + '-help'} aria-invalid={error !== null}
        onChange={(event) => { setText(event.target.value); setReport(null); setError(null); }} />
      <div className="wb-toolbar"><button type="button" className="wb-primary" onClick={run}>Run sandbox scenario</button></div>
      {error === null ? null : <p className="wb-error" role="alert">{error}</p>}
    </section>
    {report === null ? null : <LabResults report={report} />}
    <ExperimentWorkbench />
  </div>;
}

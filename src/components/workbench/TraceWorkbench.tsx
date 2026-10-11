import { useState } from 'react';
import { scenarioCatalog } from '../../scenarios/catalog';
import { createTraceBundle, serializeTraceBundle, verifyTraceBundle } from '../../inspection/bundle';
import type { TraceBundle } from '../../inspection/types';
import { TraceInspection } from './TraceInspection';
export function TraceWorkbench() {
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0]!.id);
  const [text, setText] = useState('');
  const [bundle, setBundle] = useState<TraceBundle | null>(null);
  const [error, setError] = useState('');
  function verify() {
    const result = verifyTraceBundle(text);
    if (result.ok) { setBundle(result.bundle); setError(''); }
    else { setBundle(null); setError('Trace verification failed: ' + result.code); }
  }
  function generate() {
    const scenario = scenarioCatalog.find((item) => item.id === scenarioId);
    if (scenario === undefined) return;
    try {
      const result = createTraceBundle(scenario);
      setBundle(result); setText(serializeTraceBundle(result)); setError('');
    } catch { setBundle(null); setError('This scenario exceeds the bounded trace bundle limits.'); }
  }
  return <section className="wb-panel wb-stack" aria-label="Evidence trace workbench">
    <div><h3>Evidence trace inspection</h3><p>Reconstruct complete paired traces before inspecting observations, state changes and claim support. Hashes establish internal consistency.</p></div>
    <label>Trace example scenario<select aria-label="Trace example scenario" value={scenarioId} onChange={(event) => { setScenarioId(event.target.value); setBundle(null); setError(''); }}>
      {scenarioCatalog.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
    </select></label>
    <button className="wb-secondary" type="button" onClick={generate}>Generate sandbox bundle</button>
    <label>Trace bundle JSON<textarea aria-label="Trace bundle JSON" className="wb-json-editor" value={text} maxLength={4 * 1024 * 1024} spellCheck={false}
      onChange={(event) => { setText(event.target.value); setBundle(null); setError(''); }} /></label>
    <button className="wb-primary" type="button" onClick={verify}>Verify trace bundle</button>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {bundle !== null && <TraceInspection key={bundle.bundleDigest} bundle={bundle} />}
  </section>;
}

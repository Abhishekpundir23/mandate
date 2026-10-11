import { useState } from 'react';
import { scenarioCatalog } from '../../scenarios/catalog';
import { capabilityInventory, compileRecipe, parseRecipe, previewRecipe, recipeFromScenario, serializeRecipe } from '../../authoring';
import type { ScenarioDefinition } from '../../domain/types';
import type { LabReport } from '../../lab/types';
import { JsonOutput } from './JsonOutput';
const inventory = capabilityInventory();
export function RecipeWorkbench() {
  const [selectedId, setSelectedId] = useState(scenarioCatalog[0]!.id);
  const [text, setText] = useState(() => serializeRecipe(recipeFromScenario(scenarioCatalog[0]!)));
  const [scenario, setScenario] = useState<ScenarioDefinition | null>(null);
  const [report, setReport] = useState<LabReport | null>(null); const [error, setError] = useState('');
  function invalidate() { setScenario(null); setReport(null); setError(''); }
  function compile() { invalidate(); try { setScenario(compileRecipe(parseRecipe(text))); } catch { setError('Recipe rejected. Check explicit operations, capability arguments, ordering, recovery and literal oracles.'); } }
  function run() { try { const result = previewRecipe(parseRecipe(text)); setScenario(result.scenario); setReport(result.report); setError(''); } catch { invalidate(); setError('Recipe sandbox run rejected. Check world facts and declared expectations.'); } }
  return <section className="wb-panel wb-stack" aria-label="Guided scenario authoring">
    <div><h3>Scenario recipes</h3><p>Write explicit source turns, authority operations, capability arguments and expected worlds. Compilation derives source references, version bases, resources, effects and fingerprints. Prose grants no permission.</p></div>
    <label>Starting scenario<select aria-label="Starting scenario" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{scenarioCatalog.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <button type="button" className="wb-secondary" onClick={() => { const selected = scenarioCatalog.find((item) => item.id === selectedId); if (selected !== undefined) { setText(serializeRecipe(recipeFromScenario(selected))); invalidate(); } }}>Load scenario recipe</button>
    <details><summary>Supported sandbox capabilities</summary><div className="wb-table-scroll" role="region" aria-label="Capability inventory" tabIndex={0}><table className="wb-table"><thead><tr><th>Capability</th><th>Derived effect</th></tr></thead><tbody>{inventory.map((item) => <tr key={item.name}><td><code>{item.name}</code></td><td>{item.effect}</td></tr>)}</tbody></table></div></details>
    <label>Recipe JSON<textarea aria-label="Recipe JSON" className="wb-json-editor" spellCheck={false} maxLength={256 * 1024} value={text} onChange={(event) => { setText(event.target.value); invalidate(); }} /></label>
    <div className="wb-button-row"><button type="button" className="wb-primary" onClick={compile}>Compile recipe</button><button type="button" className="wb-secondary" disabled={scenario === null} onClick={run}>Run compiled scenario</button></div>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {scenario !== null && <><p>Compiled {scenario.turns.length} turns and {scenario.proposalProgram.main.length} main proposals.</p><JsonOutput label="Compiled scenario JSON" value={JSON.stringify(scenario, null, 2)} /></>}
    {report !== null && <><p role="status">Mandate {report.scores.mandate.exactMandateSuccess ? 'passed' : 'failed'} · Standard {report.scores.standard.exactMandateSuccess ? 'passed' : 'failed'} · synthetic sandbox only.</p><JsonOutput label="Recipe sandbox report JSON" value={JSON.stringify(report, null, 2)} /></>}
  </section>;
}

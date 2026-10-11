import { useState } from 'react';
import { maintainedCampaign } from '../../campaigns/catalog';
import { parseCampaign, serializeCampaign } from '../../campaigns/schema';
import { runCampaign } from '../../campaigns/run';
import { compareCampaignReports } from '../../campaigns/report';
import type { CampaignReport } from '../../campaigns/types';
import { CampaignResults } from './CampaignResults';
export function CampaignWorkbench() {
  const [text, setText] = useState(() => serializeCampaign(maintainedCampaign));
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [previous, setPrevious] = useState<CampaignReport | null>(null);
  const [error, setError] = useState('');
  function run() {
    try { const next = runCampaign(parseCampaign(text)); setPrevious(report); setReport(next); setError(''); }
    catch { setReport(null); setError('Campaign rejected. Check strict schemas, unique IDs, referenced scenarios and bounded explicit edits.'); }
  }
  return <section className="wb-panel wb-stack" aria-label="Adversarial campaign workbench">
    <div><h3>Adversarial campaigns</h3><p>Run explicit authority, scenario and trace mutations against literal invariants. Synthetic inputs only; no external actions are performed. The canonical benchmark stays separate.</p></div>
    <button type="button" className="wb-secondary" onClick={() => { setText(serializeCampaign(maintainedCampaign)); setReport(null); setPrevious(null); setError(''); }}>Load maintained campaign</button>
    <label>Campaign JSON<textarea aria-label="Campaign JSON" className="wb-json-editor" value={text} maxLength={2 * 1024 * 1024} spellCheck={false}
      onChange={(event) => { setText(event.target.value); setReport(null); setError(''); }} /></label>
    <button type="button" className="wb-primary" onClick={run}>Run campaign</button>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {report !== null && previous !== null && <p>Compared with previous run: {compareCampaignReports(previous, report).changes.length} changed cases.</p>}
    {report !== null && <CampaignResults key={report.reportDigest} report={report} />}
  </section>;
}

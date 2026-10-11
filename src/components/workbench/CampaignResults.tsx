import { useState } from 'react';
import type { CampaignReport } from '../../campaigns/types';
import { queryCampaign, summarizeCampaign, redactCampaignReport } from '../../campaigns/report';
import { JsonOutput } from './JsonOutput';
export function CampaignResults({ report }: { readonly report: CampaignReport }) {
  const [filter, setFilter] = useState('all'); const [page, setPage] = useState(1);
  const [text, setText] = useState(''); const [selected, setSelected] = useState('');
  const [redacted, setRedacted] = useState(false);
  const summary = summarizeCampaign(report);
  const query = queryCampaign(report, { text, page, pageSize: 10,
    ...(filter === 'failed' ? { passed: false } : filter === 'rejected' ? { status: 'REJECTED' } : filter === 'errors' ? { status: 'ERROR' } : {}) });
  const detail = report.cases.find((row) => row.id === selected);
  return <div className="wb-stack">
    <p role="status">{summary.total} synthetic cases · {summary.passed} passed · {summary.failed} failed · {summary.errors} mutation errors</p>
    <p>Expected rejections pass their declared invariant. Mutation errors always fail.</p>
    <div className="wb-field-grid">
      <label>Campaign result filter<select aria-label="Campaign result filter" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); setSelected(''); }}>
        <option value="all">All cases</option><option value="failed">Failed invariants</option><option value="rejected">Rejected inputs</option><option value="errors">Mutation errors</option>
      </select></label>
      <label>Search campaign cases<input value={text} maxLength={256} onChange={(event) => { setText(event.target.value); setPage(1); setSelected(''); }} /></label>
    </div>
    <div className="wb-table-scroll" role="region" aria-label="Campaign result rows" tabIndex={0}>
      <table className="wb-table" aria-label="Campaign results"><thead><tr><th>Case</th><th>Kind</th><th>Status</th><th>Invariant</th></tr></thead>
        <tbody>{query.items.map((row) => <tr key={row.id}><td><button type="button" className="wb-secondary" onClick={() => setSelected(row.id)}>{row.title}</button></td>
          <td>{row.kind}</td><td>{row.status}</td><td>{row.passed ? 'Pass' : 'Fail'}</td></tr>)}</tbody>
      </table>
    </div>
    {query.total === 0 && <p>No campaign cases match.</p>}
    <div className="wb-button-row">
      <button type="button" className="wb-secondary" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelected(''); }}>Previous campaign page</button>
      <span>Page {page} of {Math.max(1, query.pages)}</span>
      <button type="button" className="wb-secondary" disabled={page >= query.pages} onClick={() => { setPage((value) => value + 1); setSelected(''); }}>Next campaign page</button>
    </div>
    {detail !== undefined && <JsonOutput label="Selected campaign case JSON" value={JSON.stringify(detail, null, 2)} />}
    <label className="wb-checkbox"><input type="checkbox" checked={redacted} onChange={(event) => setRedacted(event.target.checked)} />Redact campaign output</label>
    <JsonOutput label="Campaign report JSON" value={JSON.stringify(redacted ? redactCampaignReport(report) : report, null, 2)} />
  </div>;
}

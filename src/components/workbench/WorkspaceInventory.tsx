import { useState } from 'react';
import type { WorkspaceBundle, WorkspaceEntry } from '../../workspaces/types';
import { queryWorkspace, redactWorkspace, summarizeWorkspace } from '../../workspaces/inventory';
import { JsonOutput } from './JsonOutput';
export function WorkspaceInventory({ workspace, onSelect }: {
  readonly workspace: WorkspaceBundle; readonly onSelect: (entry: WorkspaceEntry) => void;
}) {
  const [kind, setKind] = useState('all'); const [text, setText] = useState('');
  const [page, setPage] = useState(1); const [redacted, setRedacted] = useState(false);
  const query = queryWorkspace(workspace, { text, page, pageSize: 10, ...(kind === 'all' ? {} : { kind }) });
  return <div className="wb-stack">
    <div className="wb-field-grid">
      <label>Workspace entry kind<select aria-label="Workspace entry kind" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}>
        <option value="all">All kinds</option>{['POLICY', 'SESSION', 'CASES', 'TRACE', 'CAMPAIGN'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Search workspace inventory<input value={text} maxLength={256} onChange={(event) => { setText(event.target.value); setPage(1); }} /></label>
    </div>
    <div className="wb-table-scroll" role="region" aria-label="Workspace entry rows" tabIndex={0}>
      <table className="wb-table" aria-label="Workspace inventory"><thead><tr><th>Entry</th><th>Kind</th><th>References</th></tr></thead>
        <tbody>{query.items.map((entry) => <tr key={entry.id}><td><button type="button" className="wb-secondary" onClick={() => onSelect(entry)}>{entry.label || entry.id}</button><br /><code>{entry.id}</code></td>
          <td>{entry.kind}</td><td>{entry.references.join(', ') || 'None'}</td></tr>)}</tbody>
      </table>
    </div>
    {query.total === 0 && <p>No workspace entries match.</p>}
    <div className="wb-button-row">
      <button type="button" className="wb-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous inventory page</button>
      <span>Page {page} of {Math.max(1, query.pages)}</span>
      <button type="button" className="wb-secondary" disabled={page >= query.pages} onClick={() => setPage((value) => value + 1)}>Next inventory page</button>
    </div>
    <label className="wb-checkbox"><input type="checkbox" checked={redacted} onChange={(event) => setRedacted(event.target.checked)} />Redact workspace output</label>
    <JsonOutput label="Workspace inventory JSON" value={JSON.stringify(redacted ? redactWorkspace(workspace) : { summary: summarizeWorkspace(workspace), manifest: workspace.manifest }, null, 2)} />
  </div>;
}

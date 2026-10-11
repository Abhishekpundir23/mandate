import { useState } from 'react';
import type { RuntimeTrace } from '../../runtime/runner';
import { inspectEvent, queryTraceEvents } from '../../inspection/query';
import { buildCausalGraph } from '../../inspection/causal';
import { JsonOutput } from './JsonOutput';
const eventTypes = ['TURN_RECEIVED', 'DIFF_COMPILED', 'CONTRACT_VERSION_APPENDED', 'ACTION_PROPOSED', 'GATE_DECISION', 'TOOL_OBSERVATION', 'CLAIM_EVALUATED', 'FINISH_EVALUATED'] as const;
const outcomes = ['ALLOW', 'BLOCK', 'CONFIRM', 'BYPASS'] as const;
export function TraceEventExplorer({ trace }: { readonly trace: RuntimeTrace }) {
  const [type, setType] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  function reset() { setPage(1); setSelected(''); }
  const eventType = eventTypes.find((item) => item === type);
  const decision = outcomes.find((item) => item === outcome);
  const result = queryTraceEvents(trace, { text, page, pageSize: 10,
    ...(eventType === undefined ? {} : { type: eventType }), ...(decision === undefined ? {} : { outcome: decision }) });
  const detail = selected === '' ? null : inspectEvent(trace, selected);
  const graph = detail === null ? null : buildCausalGraph(trace);
  return <section className="wb-stack" aria-label="Trace event explorer">
    <div className="wb-field-grid">
      <label>Trace event type<select aria-label="Trace event type" value={type} onChange={(event) => { setType(event.target.value); reset(); }}>
        <option value="all">All types</option>{eventTypes.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Trace outcome<select aria-label="Trace outcome" value={outcome} onChange={(event) => { setOutcome(event.target.value); reset(); }}>
        <option value="all">All outcomes</option>{outcomes.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Search trace events<input value={text} maxLength={256} onChange={(event) => { setText(event.target.value); reset(); }} /></label>
    </div>
    <div className="wb-table-scroll" role="region" aria-label="Trace event rows" tabIndex={0}>
      <table className="wb-table" aria-label="Trace events"><thead><tr><th>Step</th><th>Event</th><th>Proposal</th><th>Outcome</th></tr></thead>
        <tbody>{result.items.map((event) => <tr key={event.id}>
          <td><button className="wb-secondary" type="button" onClick={() => setSelected(event.id)}>{event.id}</button></td>
          <td>{event.type}</td><td>{event.proposalId ?? '—'}</td><td>{event.outcome ?? '—'}</td>
        </tr>)}</tbody></table>
    </div>
    {result.total === 0 && <p>No trace events match.</p>}
    <div className="wb-button-row">
      <button className="wb-secondary" type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelected(''); }}>Previous trace page</button>
      <span>Page {page} of {Math.max(1, result.pages)} · {result.total} events</span>
      <button className="wb-secondary" type="button" disabled={page >= result.pages} onClick={() => { setPage((value) => value + 1); setSelected(''); }}>Next trace page</button>
    </div>
    {detail !== null && <section className="wb-stack" aria-label="Selected trace event">
      <h4>{detail.event.id} · {detail.event.type}</h4>
      <JsonOutput label="Event world delta JSON" value={JSON.stringify(detail.worldDelta, null, 2)} rows={8} />
      <JsonOutput label="Event causal links JSON" value={JSON.stringify(graph?.edges.filter((edge) => edge.from === selected || edge.to === selected), null, 2)} rows={8} />
      <details><summary>Complete event data</summary><JsonOutput label="Trace event JSON" value={JSON.stringify(detail.event, null, 2)} /></details>
    </section>}
  </section>;
}

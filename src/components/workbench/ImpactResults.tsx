import { useState } from 'react';
import type { AuthoritySnapshot } from '../../policy/types';
import { queryImpact, redactImpact, summarizeImpact } from '../../impact/report';
import type { ImpactReport } from '../../impact/types';
import { DecisionExplanation } from './DecisionExplanation';
import { JsonOutput } from './JsonOutput';
export function ImpactResults({
  report,
  before,
  after,
}: {
  readonly report: ImpactReport;
  readonly before: AuthoritySnapshot;
  readonly after: AuthoritySnapshot;
}) {
  const [filter, setFilter] = useState('all');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(1);
  const [redacted, setRedacted] = useState(false);
  const query = queryImpact(report, {
    text,
    page,
    pageSize: 10,
    ...(filter === 'changed' ? { changed: true } : filter === 'failed' ? { passed: false } : {}),
  });
  const summary = summarizeImpact(report);
  const row = report.cases.find((item) => item.id === selected);
  return (
    <div className="wb-stack">
      <p role="status">
        {summary.count} cases · {summary.changed}{' '}
        {summary.changed === 1 ? 'outcome changed' : 'outcomes changed'} · {summary.failed}{' '}
        expectations failed · {summary.unqualified} without expectations
      </p>
      <div className="wb-field-grid">
        <label>
          Impact filter
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All cases</option>
            <option value="changed">Changed outcomes</option>
            <option value="failed">Failed expectations</option>
          </select>
        </label>
        <label>
          Search impact cases
          <input
            value={text}
            maxLength={256}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <div className="wb-table-scroll" role="region" aria-label="Impact results" tabIndex={0}>
        <table className="wb-table" aria-label="Declared action impact">
          <thead>
            <tr>
              <th>Case</th>
              <th>Before</th>
              <th>After</th>
              <th>Authority</th>
              <th>Expectation</th>
            </tr>
          </thead>
          <tbody>
            {query.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    className="wb-secondary"
                    onClick={() => setSelected(item.id)}
                  >
                    {item.label}
                  </button>
                </td>
                <td>{item.before.decision.outcome}</td>
                <td>{item.after.decision.outcome}</td>
                <td>{item.authorityChanged ? 'Changed clauses' : 'Same clauses'}</td>
                <td>{item.passed === null ? 'Not specified' : item.passed ? 'Pass' : 'Fail'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.total === 0 && <p>No cases match this filter.</p>}
      <div className="wb-button-row">
        <button
          type="button"
          className="wb-secondary"
          disabled={page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous impact page
        </button>
        <span>
          Page {page} of {Math.max(1, query.pages)}
        </span>
        <button
          type="button"
          className="wb-secondary"
          disabled={page >= query.pages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next impact page
        </button>
      </div>
      {row !== undefined && (
        <section className="wb-stack" aria-label="Selected impact case">
          <h4>{row.label}</h4>
          <p>Before policy</p>
          <DecisionExplanation snapshot={before} result={row.before} />
          <p>After policy</p>
          <DecisionExplanation snapshot={after} result={row.after} />
        </section>
      )}
      <label className="wb-checkbox">
        <input
          type="checkbox"
          checked={redacted}
          onChange={(event) => setRedacted(event.target.checked)}
        />
        Redact impact output
      </label>
      <JsonOutput
        label="Impact report JSON"
        value={JSON.stringify(redacted ? redactImpact(report) : report, null, 2)}
      />
    </div>
  );
}

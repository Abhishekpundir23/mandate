import { useId, useState } from 'react';
import type { CodingAction } from '../../policy/actions';
import { querySession } from '../../sessions/query';
import type { Session } from '../../sessions/types';
import { SessionRecordInspector } from './SessionRecordInspector';

export function SessionRecords({ session }: { readonly session: Session }) {
  const prefix = useId();
  const [outcome, setOutcome] = useState<'' | 'ALLOW' | 'BLOCK' | 'CONFIRM'>('');
  const [operation, setOperation] = useState<'' | CodingAction['operation']>('');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const query = {
    text,
    order,
    pageSize: 10,
    ...(outcome === '' ? {} : { outcome }),
    ...(operation === '' ? {} : { operation }),
  };
  const firstPage = querySession(session, query);
  const currentPage = Math.min(page, Math.max(firstPage.pages, 1));
  const result =
    currentPage === 1 ? firstPage : querySession(session, { ...query, page: currentPage });
  const record =
    selected === null ? undefined : session.records.find((item) => item.sequence === selected);
  return (
    <section aria-label="Session records">
      <h4>Recorded declarations</h4>
      <div className="wb-field-grid">
        <label htmlFor={prefix + '-outcome'}>
          Filter outcome
          <select
            id={prefix + '-outcome'}
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value as typeof outcome);
              setPage(1);
            }}
          >
            <option value="">All outcomes</option>
            <option>ALLOW</option>
            <option>BLOCK</option>
            <option>CONFIRM</option>
          </select>
        </label>
        <label htmlFor={prefix + '-operation'}>
          Filter operation
          <select
            id={prefix + '-operation'}
            value={operation}
            onChange={(event) => {
              setOperation(event.target.value as typeof operation);
              setPage(1);
            }}
          >
            <option value="">All operations</option>
            <option>workspace.readFile</option>
            <option>git.commit</option>
            <option>git.push</option>
          </select>
        </label>
        <label htmlFor={prefix + '-text'}>
          Search records
          <input
            id={prefix + '-text'}
            value={text}
            maxLength={256}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label htmlFor={prefix + '-order'}>
          Record order
          <select
            id={prefix + '-order'}
            value={order}
            onChange={(event) => {
              setOrder(event.target.value as typeof order);
              setPage(1);
            }}
          >
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </select>
        </label>
      </div>
      <p>
        {result.total} matching {result.total === 1 ? 'record' : 'records'}
      </p>
      <div className="wb-table-scroll" role="region" tabIndex={0} aria-label="Session record table">
        <table className="wb-table" aria-label="Recorded action checks">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Operation</th>
              <th scope="col">Decision</th>
              <th scope="col">Resource</th>
              <th scope="col">Inspect</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr key={item.sequence} aria-selected={item.sequence === selected}>
                <th scope="row">{item.sequence}</th>
                <td>
                  <code>{item.action.operation}</code>
                </td>
                <td>
                  <span
                    className={
                      'wb-outcome wb-outcome-' + item.result.decision.outcome.toLowerCase()
                    }
                  >
                    {item.result.decision.outcome}
                  </span>
                </td>
                <td>
                  <code>{item.result.proposal.resource}</code>
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={'Inspect check ' + item.sequence}
                    onClick={() => setSelected(item.sequence)}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.total === 0 ? <p className="wb-empty">No records match these filters.</p> : null}
      <div className="wb-toolbar" aria-label="Record pages">
        <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          Previous records
        </button>
        <span>
          Page {currentPage} of {Math.max(result.pages, 1)}
        </span>
        <button
          type="button"
          disabled={currentPage >= result.pages}
          onClick={() => setPage(currentPage + 1)}
        >
          Next records
        </button>
      </div>
      {record === undefined ? null : <SessionRecordInspector session={session} record={record} />}
    </section>
  );
}

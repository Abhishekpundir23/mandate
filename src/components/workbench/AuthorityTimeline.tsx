import { useId, useState } from 'react';
import type { ClauseKind } from '../../domain/types';
import { inspectVersion } from '../../policy/history';
import { searchClauses } from '../../policy/search';
import type { AuthoritySnapshot } from '../../policy/types';
import { ClauseCard } from './ClauseCard';

export function AuthorityTimeline({ snapshot }: { readonly snapshot: AuthoritySnapshot }) {
  const prefix = useId();
  const [selected, setSelected] = useState(snapshot.current.version);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ClauseKind | ''>('');
  const [retired, setRetired] = useState(false);
  const [page, setPage] = useState(1);
  const version = snapshot.versions.some((item) => item.version === selected)
    ? selected
    : snapshot.current.version;
  const inspection = inspectVersion(snapshot, version);
  const result = searchClauses(snapshot, {
    version,
    text,
    includeRetired: retired,
    page,
    pageSize: 10,
    ...(kind === '' ? {} : { kind }),
  });
  const activeIds = new Set(inspection.activeClauses.map((clause) => clause.id));
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Authority history</h3>
      <p>Inspect a historical version here. Action checks always use the latest applied version.</p>
      <div className="wb-field-grid">
        <label htmlFor={prefix + '-version'}>
          Inspect version
          <select
            id={prefix + '-version'}
            value={version}
            onChange={(event) => {
              setSelected(
                snapshot.versions.find(({ version }) => String(version) === event.target.value)
                  ?.version ?? snapshot.current.version,
              );
              setPage(1);
            }}
          >
            {snapshot.versions.map((item) => (
              <option key={item.version} value={item.version}>
                Version {item.version} · {item.turnId}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={prefix + '-search'}>
          Search clauses
          <input
            id={prefix + '-search'}
            value={text}
            maxLength={256}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label htmlFor={prefix + '-kind'}>
          Clause kind
          <select
            id={prefix + '-kind'}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ClauseKind | '');
              setPage(1);
            }}
          >
            <option value="">All kinds</option>
            {(
              ['MAY', 'MUST', 'MUST_NOT', 'NEEDS_CONFIRMATION', 'REVOKED', 'EVIDENCE'] as const
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="wb-checkbox">
          <input
            type="checkbox"
            checked={retired}
            onChange={(event) => {
              setRetired(event.target.checked);
              setPage(1);
            }}
          />
          Include retired clauses
        </label>
      </div>
      <div className="wb-history-source">
        <strong>Source · {inspection.source.turnId}</strong>
        <blockquote>{inspection.source.quote || 'Empty bootstrap authority.'}</blockquote>
        <code>Engine hash {inspection.hash}</code>
      </div>
      <p>
        {result.total} matching {result.total === 1 ? 'clause' : 'clauses'}
      </p>
      {result.items.length === 0 ? (
        <p className="wb-empty">No clauses match this view.</p>
      ) : (
        result.items.map((clause) => (
          <ClauseCard key={clause.id} clause={clause} retired={!activeIds.has(clause.id)} />
        ))
      )}
      <div className="wb-toolbar" aria-label="Clause pages">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          Previous clauses
        </button>
        <span>
          Page {page} of {Math.max(result.pages, 1)}
        </span>
        <button
          type="button"
          disabled={page >= result.pages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next clauses
        </button>
      </div>
    </section>
  );
}

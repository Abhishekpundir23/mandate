import { useId, useMemo } from 'react';
import { analyzePolicy } from '../../policy/analysis';
import type { AuthoritySnapshot } from '../../policy/types';

export function PolicyAnalysis({ snapshot }: { readonly snapshot: AuthoritySnapshot }) {
  const prefix = useId();
  const analysis = useMemo(() => analyzePolicy(snapshot), [snapshot]);
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Policy analysis</h3>
      <p>
        Structural warnings help review authority. They do not execute actions or replace a
        declared-action check.
      </p>
      <dl className="wb-metrics">
        {Object.entries(analysis.counts).map(([kind, count]) => (
          <div key={kind}>
            <dt>{kind}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {analysis.issues.length === 0 ? (
        <p className="wb-empty">No structural issues found in the active authority.</p>
      ) : (
        <ul className="wb-issues">
          {analysis.issues.map((issue, index) => (
            <li key={index} className={'wb-issue-' + issue.severity}>
              <strong>{issue.code}</strong>
              <p>{issue.message}</p>
              <p>Clauses: {issue.clauseIds.join(', ') || 'none'}</p>
            </li>
          ))}
        </ul>
      )}
      {analysis.truncated ? (
        <p className="wb-notice">
          Showing the first 200 issues. Narrow the policy to inspect additional overlaps.
        </p>
      ) : null}
    </section>
  );
}

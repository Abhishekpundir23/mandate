import type { Clause } from '../../domain/types';

export function ClauseCard({ clause, retired = false }: { readonly clause: Clause; readonly retired?: boolean }) {
  return <article className={'wb-clause' + (retired ? ' wb-retired' : '')}>
    <div className="wb-section-heading"><code>{clause.id}</code><span className="wb-badge">{clause.kind}{retired ? ' · retired' : ''}</span></div>
    <p>{clause.statement}</p>
    {clause.selector === undefined ? null : <dl className="wb-key-values">
      {Object.entries(clause.selector).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}
    </dl>}
    {clause.revokedSelector === undefined ? null : <p>Revoked selector: <code>{JSON.stringify(clause.revokedSelector)}</code></p>}
    {clause.targetClauseIds === undefined ? null : <p>Targets: {clause.targetClauseIds.join(', ')}</p>}
    {clause.evidenceRequirement === undefined ? null : <p>Evidence for {clause.evidenceRequirement.forClauseId}: <code>{clause.evidenceRequirement.fact} = {String(clause.evidenceRequirement.equals)}</code></p>}
    <details><summary>Source · {clause.source.turnId} · introduced in version {clause.introducedIn}</summary>
      <blockquote>{clause.source.quote}</blockquote>
    </details>
  </article>;
}

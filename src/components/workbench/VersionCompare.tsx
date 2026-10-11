import { useId, useState } from 'react';
import { compareVersions } from '../../policy/compare';
import type { AuthoritySnapshot } from '../../policy/types';
import { ClauseCard } from './ClauseCard';

export function VersionCompare({ snapshot }: { readonly snapshot: AuthoritySnapshot }) {
  const prefix = useId();
  const [beforeValue, setBefore] = useState(1);
  const [afterValue, setAfter] = useState(snapshot.current.version);
  const before = snapshot.versions.some(({ version }) => version === beforeValue) ? beforeValue : 1;
  const after = snapshot.versions.some(({ version }) => version === afterValue) ? afterValue : snapshot.current.version;
  const comparison = compareVersions(snapshot, before, after);
  return <section className="wb-panel" aria-labelledby={prefix + '-title'}>
    <h3 id={prefix + '-title'}>Compare authority versions</h3>
    <div className="wb-field-grid">
      <label htmlFor={prefix + '-before'}>Before version<select id={prefix + '-before'} value={before} onChange={(event) => setBefore((snapshot.versions.find(({ version }) => String(version) === event.target.value)?.version ?? snapshot.current.version))}>
        {snapshot.versions.map(({ version }) => <option key={version} value={version}>Version {version}</option>)}
      </select></label>
      <label htmlFor={prefix + '-after'}>After version<select id={prefix + '-after'} value={after} onChange={(event) => setAfter((snapshot.versions.find(({ version }) => String(version) === event.target.value)?.version ?? snapshot.current.version))}>
        {snapshot.versions.map(({ version }) => <option key={version} value={version}>Version {version}</option>)}
      </select></label>
    </div>
    <p className="wb-notice">Authority {comparison.authorityChanged ? 'changed' : 'unchanged'} · source {comparison.sourceChanged ? 'changed' : 'unchanged'}</p>
    <div className="wb-compare-grid">
      <section aria-label="Activated clauses"><h4>{comparison.activated.length} activated clauses</h4>
        {comparison.activated.map((clause) => <ClauseCard key={clause.id} clause={clause} />)}
      </section>
      <section aria-label="Retired clauses"><h4>{comparison.retired.length} retired clauses</h4>
        {comparison.retired.map((clause) => <ClauseCard key={clause.id} clause={clause} retired />)}
      </section>
    </div>
    <p>{comparison.unchanged.length} unchanged clauses · {comparison.appended.length} newly appended ledger entries</p>
  </section>;
}

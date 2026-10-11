import { useState } from 'react';
import { parseCaseSuite } from '../../impact/cases';
import { exampleCaseSuite } from '../../impact/examples';
import { comparePolicyImpact, policyAtVersion } from '../../impact/compare';
import type { ImpactReport } from '../../impact/types';
import type { AuthoritySnapshot } from '../../policy/types';
import { parsePolicyJson } from '../../policy/parse';
import { ImpactResults } from './ImpactResults';
export function ImpactWorkbench({ snapshot }: { readonly snapshot: AuthoritySnapshot }) {
  const [policyText, setPolicyText] = useState(() => JSON.stringify(snapshot.document, null, 2));
  const [caseText, setCaseText] = useState(() => JSON.stringify(exampleCaseSuite, null, 2));
  const [source, setSource] = useState('candidate');
  const [beforeVersion, setBeforeVersion] = useState(snapshot.versions[0]!.version);
  const [afterVersion, setAfterVersion] = useState(snapshot.current.version);
  const [result, setResult] = useState<{ report: ImpactReport; before: AuthoritySnapshot; after: AuthoritySnapshot } | null>(null);
  const [error, setError] = useState('');
  function invalidate() { setResult(null); setError(''); }
  function run() {
    try {
      const before = source === 'history' ? policyAtVersion(snapshot, beforeVersion) : snapshot;
      const after = source === 'history' ? policyAtVersion(snapshot, afterVersion) : parsePolicyJson(policyText);
      const report = comparePolicyImpact(before, after, parseCaseSuite(caseText));
      setResult({ report, before, after }); setError('');
    } catch { setResult(null); setError('Comparison rejected. Check both policies, declared action scope and strict case suite JSON.'); }
  }
  const versionField = (label: string, value: number, update: (number: number) => void) => <label>{label}
    <select value={value} onChange={(event) => {
      const selected = snapshot.versions.find((item) => String(item.version) === event.target.value);
      if (selected !== undefined) { update(selected.version); invalidate(); }
    }}>{snapshot.versions.map((item) => <option key={item.version} value={item.version}>Version {item.version}</option>)}</select>
  </label>;
  return <section className="wb-panel wb-stack" aria-label="Policy impact workbench">
    <div><h3>Policy change impact</h3><p>Compare up to 100 declared actions. Literal expectations qualify each case; an omitted expectation is unqualified. No declared action is executed.</p></div>
    <label>Comparison source<select value={source} onChange={(event) => { setSource(event.target.value); invalidate(); }}>
      <option value="candidate">Applied policy versus candidate</option><option value="history">Historical versions</option>
    </select></label>
    {source === 'candidate' ? <label>Candidate policy JSON<textarea aria-label="Candidate policy JSON" className="wb-json-editor" spellCheck={false} maxLength={262144}
      value={policyText} onChange={(event) => { setPolicyText(event.target.value); invalidate(); }} /></label>
      : <div className="wb-field-grid">{versionField('Before version', beforeVersion, setBeforeVersion)}{versionField('After version', afterVersion, setAfterVersion)}</div>}
    <label>Declared cases JSON<textarea aria-label="Declared cases JSON" className="wb-json-editor" spellCheck={false} maxLength={262144} value={caseText}
      onChange={(event) => { setCaseText(event.target.value); invalidate(); }} /></label>
    <button type="button" className="wb-primary" onClick={run}>Compare declared cases</button>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {result !== null && <ImpactResults key={result.report.reportDigest} {...result} />}
  </section>;
}

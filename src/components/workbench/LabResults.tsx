import type { LabReport } from '../../lab/types';
import { JsonOutput } from './JsonOutput';

export function LabResults({ report }: { readonly report: LabReport }) {
  const standard = report.scores.standard;
  const mandate = report.scores.mandate;
  const verdict = (value: boolean) => value ? 'Pass' : 'Fail';
  const rows = [
    ['Exact mandate success', verdict(standard.exactMandateSuccess), verdict(mandate.exactMandateSuccess)],
    ['Required action coverage', standard.requiredCoverage, mandate.requiredCoverage],
    ['Evidence coverage', standard.evidenceCoverage, mandate.evidenceCoverage],
    ['Unauthorized effects', standard.unauthorizedEffects, mandate.unauthorizedEffects],
    ['False claims', standard.falseClaims, mandate.falseClaims],
    ['Unnecessary confirmations', standard.unnecessaryConfirmations, mandate.unnecessaryConfirmations],
    ['Recovery', verdict(standard.recoverySuccess), verdict(mandate.recoverySuccess)],
    ['Terminal predicates', verdict(standard.mustPredicatesSatisfied), verdict(mandate.mustPredicatesSatisfied)],
    ['Exact terminal state', verdict(standard.exactState), verdict(mandate.exactState)],
    ['Trace reconstruction', verdict(standard.traceable), verdict(mandate.traceable)],
  ] as const;
  return <section className="wb-panel" aria-label="Sandbox results">
    <h3>{report.title}</h3>
    <p className="wb-help">Custom lab result · deterministic sandbox · externalActionsPerformed: false</p>
    <div className="wb-table-scroll" role="region" aria-label="Paired score table" tabIndex={0}>
      <table className="wb-table" aria-label="Paired sandbox scores">
        <thead><tr><th scope="col">Metric</th><th scope="col">Standard</th><th scope="col">Mandate</th></tr></thead>
        <tbody>{rows.map(([label, left, right]) => <tr key={label}><th scope="row">{label}</th><td>{left}</td><td>{right}</td></tr>)}</tbody>
      </table>
    </div>
    <dl className="wb-key-values">
      <div><dt>Scenario checksum</dt><dd><code>{report.checksums.scenario}</code></dd></div>
      <div><dt>Proposal checksum</dt><dd><code>{report.checksums.proposal}</code></dd></div>
      <div><dt>Paired trace checksum</dt><dd><code>{report.checksums.trace}</code></dd></div>
    </dl>
    <p className="wb-help">These fixture checksums identify reproducible inputs and traces. They do not authenticate an external run.</p>
    {report.diagnostics.length === 0 ? <p>No scoring diagnostics.</p> : <ul className="wb-issues">
      {report.diagnostics.map((item, index) => <li key={index}><strong>{item.lane} · {item.code}</strong><p>{item.message}</p></li>)}
    </ul>}
    <details><summary>Complete report JSON</summary><JsonOutput label="Lab report JSON" value={JSON.stringify(report, null, 2)} /></details>
  </section>;
}

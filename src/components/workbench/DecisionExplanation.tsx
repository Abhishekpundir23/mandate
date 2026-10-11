import { useId } from 'react';
import { explainDecision, type ActionCheckResult } from '../../policy/service';
import type { AuthoritySnapshot } from '../../policy/types';
import { ClauseCard } from './ClauseCard';

export function DecisionExplanation({ snapshot, result }: { readonly snapshot: AuthoritySnapshot; readonly result: ActionCheckResult | null }) {
  const prefix = useId();
  if (result === null) return <section className="wb-panel wb-empty" aria-label="Decision explanation">
    <h3>Decision explanation</h3><p>Check an action to see the current decision and its authority.</p>
  </section>;
  const explanation = explainDecision(snapshot, result);
  return <section className="wb-panel" aria-labelledby={prefix + '-title'}>
    <h3 id={prefix + '-title'}>Decision explanation</h3>
    <p className={'wb-decision wb-decision-' + explanation.outcome.toLowerCase()} role="status" aria-label="Action decision">
      <strong>{explanation.outcome}</strong><span>Version {explanation.contractVersion} · advisory · executionPerformed: false</span>
    </p>
    <p className="wb-resource"><code>{result.proposal.resource}</code></p>
    <ul className="wb-reasons">{explanation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    {explanation.matchedClauses.length === 0 ? <p>No active clause grants this action.</p> : explanation.matchedClauses.map((clause) => <ClauseCard key={clause.id} clause={clause} />)}
    <details><summary>Decision metadata and limitations</summary>
      <dl className="wb-key-values">
        <div><dt>Policy digest</dt><dd><code>{explanation.policyDigest}</code></dd></div>
        <div><dt>Action fingerprint</dt><dd><code>{result.proposal.fingerprint}</code></dd></div>
        <div><dt>Effect</dt><dd>{result.proposal.effect}</dd></div>
      </dl>
      <ul>{explanation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </details>
  </section>;
}

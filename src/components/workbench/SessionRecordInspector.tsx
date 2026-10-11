import { useMemo } from 'react';
import { parsePolicyJson } from '../../policy/parse';
import type { Session, SessionRecord } from '../../sessions/types';
import { DecisionExplanation } from './DecisionExplanation';
import { JsonOutput } from './JsonOutput';

export function SessionRecordInspector({
  session,
  record,
}: {
  readonly session: Session;
  readonly record: SessionRecord;
}) {
  const snapshot = useMemo(() => parsePolicyJson(JSON.stringify(session.policy)), [session.policy]);
  return (
    <section aria-label="Selected session check" className="wb-record-inspector">
      <h4>Selected check {record.sequence}</h4>
      <DecisionExplanation snapshot={snapshot} result={record.result} />
      <details>
        <summary>Record hashes and complete JSON</summary>
        <dl className="wb-key-values">
          <div>
            <dt>Previous hash</dt>
            <dd>
              <code>{record.previousHash}</code>
            </dd>
          </div>
          <div>
            <dt>Record hash</dt>
            <dd>
              <code>{record.hash}</code>
            </dd>
          </div>
        </dl>
        <JsonOutput label="Selected record JSON" value={JSON.stringify(record, null, 2)} />
      </details>
    </section>
  );
}

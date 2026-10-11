import { useId, useState } from 'react';
import { compareSessions, type SessionComparison as Comparison } from '../../sessions/compare';
import type { Session } from '../../sessions/types';
import { verifySession } from '../../sessions/verify';
import { JsonOutput } from './JsonOutput';

export function SessionComparison({ session }: { readonly session: Session }) {
  const prefix = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [compared, setCompared] = useState<{
    readonly baselineHash: string;
    readonly report: Comparison;
  } | null>(null);
  const report = compared?.baselineHash === session.terminalHash ? compared.report : null;
  const compare = (): void => {
    const verified = verifySession(text);
    if (!verified.ok) {
      setError('Comparison session failed verification.');
      setCompared(null);
      return;
    }
    setError(null);
    setCompared({
      baselineHash: session.terminalHash,
      report: compareSessions(session, verified.session),
    });
  };
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Compare decision sessions</h3>
      <p className="wb-help">
        Checks align by sequence. An action change is reported separately from a decision change.
      </p>
      <label htmlFor={prefix + '-input'}>Comparison session JSON</label>
      <textarea
        id={prefix + '-input'}
        className="wb-json-editor wb-short-editor"
        spellCheck={false}
        value={text}
        maxLength={1048576}
        onChange={(event) => {
          setText(event.target.value);
          setCompared(null);
          setError(null);
        }}
      />
      <div className="wb-toolbar">
        <button type="button" onClick={compare}>
          Compare sessions
        </button>
      </div>
      {error === null ? null : (
        <p className="wb-error" role="alert">
          {error}
        </p>
      )}
      {report === null ? null : (
        <>
          <p role="status" aria-label="Session comparison status">
            {report.changes.length} changed {report.changes.length === 1 ? 'record' : 'records'} ·{' '}
            {report.unchangedCount} unchanged
          </p>
          <p>Policy digest {report.policyChanged ? 'changed' : 'unchanged'}</p>
          <JsonOutput label="Session comparison JSON" value={JSON.stringify(report, null, 2)} />
        </>
      )}
    </section>
  );
}

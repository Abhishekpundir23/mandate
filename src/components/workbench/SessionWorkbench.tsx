import { useId, useMemo, useState } from 'react';
import { serializeSession } from '../../sessions/record';
import { redactSession } from '../../sessions/redact';
import { summarizeSession } from '../../sessions/summary';
import type { Session } from '../../sessions/types';
import { verifySession } from '../../sessions/verify';
import { JsonOutput } from './JsonOutput';
import { SessionComparison } from './SessionComparison';
import { SessionRecords } from './SessionRecords';

function SessionDetails({ session, title }: { readonly session: Session; readonly title: string }) {
  const prefix = useId();
  const [redacted, setRedacted] = useState(false);
  const summary = useMemo(() => summarizeSession(session), [session]);
  const serialized = useMemo(() => serializeSession(session), [session]);
  return <>
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>{title}</h3>
      <p>{summary.sessionId}{summary.label === '' ? '' : ' · ' + summary.label}</p>
      <p className="wb-help">{summary.recordCount} records · advisory · executionPerformed: false</p>
      <dl className="wb-metrics">{Object.entries(summary.outcomes).map(([outcome, count]) => <div key={outcome}><dt>{outcome}</dt><dd>{count}</dd></div>)}</dl>
      <details><summary>Policy and session identity</summary><dl className="wb-key-values">
        <div><dt>Policy digest</dt><dd><code>{summary.policyDigest}</code></dd></div>
        <div><dt>Root hash</dt><dd><code>{session.rootHash}</code></dd></div>
        <div><dt>Terminal hash</dt><dd><code>{session.terminalHash}</code></dd></div>
        <div><dt>Resources</dt><dd>{summary.distinctResources}</dd></div>
      </dl></details>
      <SessionRecords key={session.sessionId + ':' + session.policyDigest} session={session} />
    </section>
    <section className="wb-panel" aria-label="Session export">
      <h3>Export and disclosure</h3>
      <JsonOutput label="Session export JSON" value={serialized}
        help="Contains the full policy, action arguments and resources. Hashes verify consistency, not identity or human approval." />
      <button type="button" onClick={() => setRedacted((value) => !value)}>{redacted ? 'Hide redacted report' : 'Show redacted report'}</button>
      {redacted ? <JsonOutput label="Redacted report JSON" value={JSON.stringify(redactSession(session), null, 2)}
        help="This report is not replayable. Hash aliases reduce direct disclosure but do not guarantee anonymity." /> : null}
    </section>
    <SessionComparison session={session} />
  </>;
}

export function SessionWorkbench({ session, onReset }: { readonly session: Session; readonly onReset: () => void }) {
  const prefix = useId();
  const [text, setText] = useState('');
  const [source, setSource] = useState<'current' | 'imported'>('current');
  const [imported, setImported] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = source === 'current' ? session : imported;
  const verify = (): void => {
    const result = verifySession(text);
    setSource('imported');
    if (!result.ok) {
      setImported(null); setError('Session verification failed: ' + result.errors.map((item) => item.code).join(', ')); return;
    }
    setImported(result.session); setError(null);
  };
  return <div className="wb-stack">
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Session inspector</h3>
      <p>Inspect the active recorder or paste an independent bundle. Importing a session never changes the applied policy.</p>
      <div className="wb-toolbar">
        <button type="button" aria-pressed={source === 'current'} onClick={() => setSource('current')}>Inspect current session</button>
        <button type="button" onClick={onReset}>Start new session</button>
      </div>
      <label htmlFor={prefix + '-input'}>Import session JSON</label>
      <textarea id={prefix + '-input'} className="wb-json-editor wb-short-editor" value={text} spellCheck={false} maxLength={1048576}
        onChange={(event) => { setText(event.target.value); setImported(null); setError(null); }} />
      <div className="wb-toolbar"><button type="button" onClick={verify}>Verify session</button></div>
      {error === null ? null : <p className="wb-error" role="alert">{error}</p>}
      {imported === null ? null : <p className="wb-notice" role="status" aria-label="Session import status">Verified internally · not authenticated</p>}
    </section>
    {active === null ? <p className="wb-empty">Verify imported JSON before inspecting it.</p>
      : <SessionDetails key={source + ':' + active.sessionId + ':' + active.policyDigest} session={active}
        title={source === 'current' ? 'Current session' : 'Imported session'} />}
  </div>;
}

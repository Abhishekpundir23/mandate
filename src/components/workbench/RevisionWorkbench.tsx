import { useState } from 'react';
import { utf8Length } from '../../policy/utf8';
import { policyJsonLimits } from '../../policy/json';
import type { AuthoritySnapshot } from '../../policy/types';
import {
  createRevisionDraft,
  parseRevision,
  previewRevision,
  type RevisionPreview,
} from '../../policy/revisions';
import { RevisionAuthor } from './RevisionAuthor';
import { JsonOutput } from './JsonOutput';

export function RevisionWorkbench({
  snapshot,
  dirty,
  onApply,
}: {
  readonly snapshot: AuthoritySnapshot;
  readonly dirty: boolean;
  readonly onApply: (policyText: string) => void;
}) {
  const [turn, setTurn] = useState('revision-' + (snapshot.current.version + 1));
  const [quote, setQuote] = useState('Discuss the next policy revision.');
  const [text, setText] = useState(() =>
    JSON.stringify(
      createRevisionDraft(
        snapshot,
        'revision-' + (snapshot.current.version + 1),
        'Discuss the next policy revision.',
      ),
      null,
      2,
    ),
  );
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [error, setError] = useState('');
  function edit(value: string) {
    setText(value);
    setPreview(null);
    setError('');
  }
  function draft() {
    try {
      edit(JSON.stringify(createRevisionDraft(snapshot, turn, quote), null, 2));
    } catch {
      setPreview(null);
      setError('Revision rejected. Supply a unique turn and a nonempty exact source quote.');
    }
  }
  function inspect() {
    try {
      setPreview(previewRevision(snapshot, parseRevision(text)));
      setError('');
    } catch {
      setPreview(null);
      setError(
        'Revision rejected. Check the digest, base version, provenance, targets and operation shape.',
      );
    }
  }
  const current = preview?.beforeDigest === snapshot.policyDigest ? preview : null;
  return (
    <section className="wb-panel wb-stack" aria-label="Guided policy revisions">
      <div>
        <h3>Guided policy revisions</h3>
        <p>
          Declare ADD, REVOKE, REPLACE or NO_CHANGE operations explicitly. Source text alone never
          creates authority.
        </p>
      </div>
      <div className="wb-field-grid">
        <label>
          Source turn
          <input
            value={turn}
            maxLength={256}
            onChange={(event) => {
              setTurn(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label>
          Exact source quote
          <textarea
            aria-label="Exact source quote"
            value={quote}
            maxLength={8192}
            onChange={(event) => {
              setQuote(event.target.value);
              setPreview(null);
            }}
          />
        </label>
      </div>
      <button type="button" className="wb-secondary" onClick={draft}>
        Create discussion draft
      </button>
      <RevisionAuthor
        snapshot={snapshot}
        turnId={turn}
        quote={quote}
        onDraft={edit}
        onInvalidate={() => {
          setPreview(null);
          setError('');
        }}
      />
      <label>
        Revision JSON
        <textarea
          aria-label="Revision JSON"
          className="wb-json-editor"
          spellCheck={false}
          value={text}
          maxLength={65536}
          onChange={(event) => edit(event.target.value)}
        />
      </label>
      <div className="wb-secondary-row">
        <button type="button" className="wb-secondary" onClick={inspect}>
          Preview revision
        </button>
        <button
          type="button"
          className="wb-primary"
          disabled={current === null || dirty}
          onClick={() => {
            if (current !== null && !dirty) {
              const readable = JSON.stringify(current.policy, null, 2);
              onApply(utf8Length(readable) <= policyJsonLimits.bytes ? readable : JSON.stringify(current.policy));
            }
          }}
        >
          Apply revision
        </button>
      </div>
      {dirty && <p>Apply or reset the policy editor draft before applying a revision.</p>}
      {error && (
        <p role="alert" className="wb-error">
          {error}
        </p>
      )}
      {current !== null && (
        <div className="wb-stack">
          <p role="status">
            Version {current.beforeVersion} → {current.afterVersion}. No declared action executed.
          </p>
          <p>
            {current.changes.activated.length} activated · {current.changes.retired.length} retired
          </p>
          {current.warnings.map((warning) => (
            <p key={warning} className="wb-warning">
              {warning}
            </p>
          ))}
          <details>
            <summary>Complete revision preview</summary>
            <JsonOutput label="Revision preview JSON" value={JSON.stringify(current, null, 2)} />
          </details>
        </div>
      )}
    </section>
  );
}

import { useState } from 'react';
import { authorRevision } from '../../policy/revision-authoring';
import type { AuthoritySnapshot } from '../../policy/types';

export function RevisionAuthor({
  snapshot,
  turnId,
  quote,
  onDraft,
  onInvalidate,
}: {
  readonly snapshot: AuthoritySnapshot;
  readonly turnId: string;
  readonly quote: string;
  readonly onDraft: (text: string) => void;
  readonly onInvalidate: () => void;
}) {
  const [operation, setOperation] = useState('ADD');
  const [kind, setKind] = useState('MAY');
  const [capability, setCapability] = useState('workspace.readFile');
  const [id, setId] = useState('new-clause');
  const [statement, setStatement] = useState('Inspect declared files.');
  const [resource, setResource] = useState('');
  const [targetId, setTargetId] = useState('read');
  const [error, setError] = useState('');
  const writesClause = operation === 'ADD' || operation === 'REPLACE';
  function build() {
    try {
      const request = writesClause
        ? {
            turnId,
            quote,
            operation,
            id,
            kind,
            statement,
            capability,
            ...(resource === '' ? {} : { resource }),
            ...(kind === 'NEEDS_CONFIRMATION' ? { afterConfirmation: 'MAY' } : {}),
            ...(operation === 'REPLACE' ? { targetId } : {}),
          }
        : { turnId, quote, operation, targetId, tombstoneId: id };
      onDraft(JSON.stringify(authorRevision(snapshot, request), null, 2));
      setError('');
    } catch {
      setError(
        'Cannot build this revision. Check clause IDs, source, capability scope and protected targets.',
      );
    }
  }
  return (
    <fieldset className="wb-stack">
      <legend>Build an explicit operation</legend>
      <div className="wb-field-grid">
        <label>
          Revision operation
          <select
            value={operation}
            onChange={(event) => {
              onInvalidate();
              setOperation(event.target.value);
              setError('');
            }}
          >
            <option value="ADD">Add clause</option>
            <option value="REVOKE">Retire clause</option>
            <option value="REPLACE">Replace grant</option>
          </select>
        </label>
        <label>
          New clause ID
          <input
            value={id}
            maxLength={256}
            onChange={(event) => {
              onInvalidate();
              setId(event.target.value);
            }}
          />
        </label>
        {operation !== 'ADD' && (
          <label>
            Target clause ID
            <input
              value={targetId}
              maxLength={256}
              onChange={(event) => {
                onInvalidate();
                setTargetId(event.target.value);
              }}
            />
          </label>
        )}
        {writesClause && (
          <>
            <label>
              Clause kind
              <select
                value={kind}
                onChange={(event) => {
                  onInvalidate();
                  setKind(event.target.value);
                }}
              >
                <option value="MAY">MAY</option>
                <option value="MUST">MUST</option>
                <option value="MUST_NOT">MUST_NOT</option>
                <option value="NEEDS_CONFIRMATION">NEEDS_CONFIRMATION (then MAY)</option>
              </select>
            </label>
            <label>
              Declared capability
              <select
                value={capability}
                onChange={(event) => {
                  onInvalidate();
                  setCapability(event.target.value);
                }}
              >
                <option value="workspace.readFile">workspace.readFile</option>
                <option value="git.commit">git.commit</option>
                <option value="git.push">git.push</option>
              </select>
            </label>
            <label>
              Clause statement
              <input
                value={statement}
                maxLength={8192}
                onChange={(event) => {
                  onInvalidate();
                  setStatement(event.target.value);
                }}
              />
            </label>
            <label>
              Exact resource (optional)
              <input
                value={resource}
                maxLength={2048}
                onChange={(event) => {
                  onInvalidate();
                  setResource(event.target.value);
                }}
              />
            </label>
          </>
        )}
      </div>
      <p className="wb-help">
        Replacing a grant creates a denial tombstone. Retiring that tombstone is a separate explicit
        revision. Evidence and multi-operation changes can be authored in JSON below.
      </p>
      <button type="button" className="wb-secondary" onClick={build}>
        Build revision JSON
      </button>
      {error && (
        <p role="alert" className="wb-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

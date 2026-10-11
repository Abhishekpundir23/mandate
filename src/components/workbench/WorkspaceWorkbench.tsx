import { useState } from 'react';
import type { AuthoritySnapshot } from '../../policy/types';
import type { Session } from '../../sessions/types';
import { createWorkspace, serializeWorkspace, verifyWorkspace } from '../../workspaces/bundle';
import {
  addWorkspaceEntry,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
} from '../../workspaces/mutate';
import { parseWorkspaceEntry } from '../../workspaces/entries';
import type { WorkspaceBundle } from '../../workspaces/types';
import { WorkspaceInventory } from './WorkspaceInventory';
import { JsonOutput } from './JsonOutput';
export function WorkspaceWorkbench({
  snapshot,
  session,
  onStagePolicy,
}: {
  readonly snapshot: AuthoritySnapshot;
  readonly session: Session;
  readonly onStagePolicy: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceBundle | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [newId, setNewId] = useState('');
  const [entryText, setEntryText] = useState('');
  const [cascade, setCascade] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function accept(next: WorkspaceBundle) {
    setWorkspace(next);
    setText(serializeWorkspace(next));
    setError('');
    setNotice('');
  }
  function create() {
    try {
      accept(
        createWorkspace('local-workspace', 'Local workbench', [
          {
            id: 'policy',
            label: 'Applied policy',
            kind: 'POLICY',
            references: [],
            payload: snapshot.document,
          },
          {
            id: 'session',
            label: 'Current session',
            kind: 'SESSION',
            references: ['policy'],
            payload: session,
          },
        ]),
      );
      setSelectedId('');
    } catch {
      setWorkspace(null);
      setError('Workspace creation rejected. Check applied policy and session consistency.');
    }
  }
  function verify() {
    const result = verifyWorkspace(text);
    if (result.ok) {
      accept(result.workspace);
      setSelectedId('');
    } else {
      setWorkspace(null);
      setError('Workspace verification failed: ' + result.code);
    }
  }
  function change(kind: 'add' | 'rename' | 'remove') {
    if (workspace === null) return;
    try {
      const next =
        kind === 'add'
          ? addWorkspaceEntry(workspace, parseWorkspaceEntry(entryText))
          : kind === 'rename'
            ? renameWorkspaceEntry(workspace, selectedId, newId)
            : removeWorkspaceEntry(workspace, selectedId, { cascade });
      accept(next);
      setSelectedId(kind === 'rename' ? newId : '');
      setCascade(false);
    } catch {
      setError(
        'Entry change rejected. Check unique IDs, references, nested verification and dependent entries.',
      );
    }
  }
  const selected = workspace?.entries.find((entry) => entry.id === selectedId);
  return (
    <section className="wb-panel wb-stack" aria-label="Portable workspace workbench">
      <div>
        <h3>Portable workspaces</h3>
        <p>
          Collect policies, advisory sessions, declared cases, paired traces and campaigns. Imports
          independently verify each artifact and its references. Consistency does not authenticate
          approval.
        </p>
      </div>
      <button type="button" className="wb-secondary" onClick={create}>
        Create workspace from applied policy
      </button>
      <label>
        Workspace JSON
        <textarea
          aria-label="Workspace JSON"
          className="wb-json-editor"
          value={text}
          maxLength={8 * 1024 * 1024}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setWorkspace(null);
            setSelectedId('');
            setError('');
            setNotice('');
          }}
        />
      </label>
      <button type="button" className="wb-primary" onClick={verify}>
        Verify workspace
      </button>
      {error && (
        <p role="alert" className="wb-error">
          {error}
        </p>
      )}
      {notice && <p>{notice}</p>}
      {workspace !== null && (
        <>
          <p role="status">
            Verified internally · not authenticated. {workspace.entries.length} entries.
          </p>
          <details>
            <summary>Workspace root digest</summary>
            <code>{workspace.manifest.rootDigest}</code>
          </details>
          <WorkspaceInventory
            key={workspace.manifest.rootDigest}
            workspace={workspace}
            onSelect={(entry) => {
              setSelectedId(entry.id);
              setNewId(entry.id);
              setCascade(false);
              setError('');
            }}
          />
          {selected !== undefined && (
            <section className="wb-stack" aria-label="Selected workspace entry">
              <h4>
                {selected.label || selected.id} · {selected.kind}
              </h4>
              {selected.kind === 'POLICY' && (
                <button
                  type="button"
                  className="wb-primary"
                  onClick={() => {
                    onStagePolicy(JSON.stringify(selected.payload));
                    setNotice('Policy staged. Open Policy and Apply to replace current authority.');
                  }}
                >
                  Stage selected policy
                </button>
              )}
              <label>
                New entry ID
                <input
                  value={newId}
                  maxLength={64}
                  onChange={(event) => setNewId(event.target.value)}
                />
              </label>
              <button type="button" className="wb-secondary" onClick={() => change('rename')}>
                Rename selected entry
              </button>
              <label className="wb-checkbox">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(event) => setCascade(event.target.checked)}
                />
                Remove dependent entries
              </label>
              <button type="button" className="wb-secondary" onClick={() => change('remove')}>
                Remove selected entry
              </button>
              <details>
                <summary>Selected artifact content</summary>
                <JsonOutput
                  label="Workspace entry JSON"
                  value={JSON.stringify(selected, null, 2)}
                />
              </details>
            </section>
          )}
          <details>
            <summary>Add a verified artifact</summary>
            <label>
              Entry JSON
              <textarea
                aria-label="Entry JSON"
                className="wb-json-editor"
                value={entryText}
                maxLength={8 * 1024 * 1024}
                spellCheck={false}
                onChange={(event) => setEntryText(event.target.value)}
              />
            </label>
            <button type="button" className="wb-secondary" onClick={() => change('add')}>
              Add workspace entry
            </button>
          </details>
        </>
      )}
    </section>
  );
}

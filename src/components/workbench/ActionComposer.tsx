import { useId } from 'react';
import type { ActionDraft } from '../../app/workbench-model';
import type { AuthoritySnapshot } from '../../policy/types';

interface Props {
  readonly draft: ActionDraft;
  readonly snapshot: AuthoritySnapshot;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onField: <K extends keyof ActionDraft>(field: K, value: ActionDraft[K]) => void;
  readonly onCheck: () => void;
}

export function ActionComposer({ draft, snapshot, disabled, error, onField, onCheck }: Props) {
  const prefix = useId();
  const field = (key: Exclude<keyof ActionDraft, 'operation'>, label: string, help: string) => (
    <label htmlFor={prefix + '-' + key}>
      {label}
      <input
        id={prefix + '-' + key}
        aria-label={label}
        value={draft[key]}
        maxLength={key === 'path' || key === 'ref' ? 1024 : 128}
        aria-describedby={prefix + '-' + key + '-help'}
        spellCheck={false}
        onChange={(event) => onField(key, event.target.value)}
      />
      <span id={prefix + '-' + key + '-help'} className="wb-help">
        {help}
      </span>
    </label>
  );
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Check a declared action</h3>
      <p className="wb-help">
        Checks use the latest applied version, {snapshot.current.version}. Each check is recorded.
      </p>
      <p className="wb-help">No confirmation token is issued here.</p>
      <div className="wb-field-grid">
        <label htmlFor={prefix + '-operation'}>
          Operation
          <select
            id={prefix + '-operation'}
            value={draft.operation}
            onChange={(event) =>
              onField('operation', event.target.value as ActionDraft['operation'])
            }
          >
            <option value="workspace.readFile">workspace.readFile</option>
            <option value="git.commit">git.commit</option>
            <option value="git.push">git.push</option>
          </select>
        </label>
        <label htmlFor={prefix + '-repository'}>
          Repository
          <select
            id={prefix + '-repository'}
            value={draft.repositoryId}
            onChange={(event) => onField('repositoryId', event.target.value)}
          >
            {snapshot.repositories.map(({ id }) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            {!snapshot.repositories.some(({ id }) => id === draft.repositoryId) ? (
              <option value={draft.repositoryId}>
                {draft.repositoryId || 'Select a repository'}
              </option>
            ) : null}
          </select>
        </label>
        {draft.operation === 'workspace.readFile'
          ? field('path', 'File path', 'Relative canonical path. The file is never opened.')
          : null}
        {draft.operation === 'git.commit' ? (
          <>
            {field(
              'treeDigest',
              'Tree digest',
              '64 lowercase hexadecimal characters identifying the declared tree.',
            )}
            {field(
              'messageDigest',
              'Message digest',
              '64 lowercase hexadecimal characters identifying the declared message.',
            )}
          </>
        ) : null}
        {draft.operation === 'git.push' ? (
          <>
            {field('remoteId', 'Remote ID', 'A remote configured in the applied policy.')}
            {field('ref', 'Branch ref', 'A canonical refs/heads/ branch reference.')}
            {field('commitOid', 'Commit object ID', '40 or 64 lowercase hexadecimal characters.')}
          </>
        ) : null}
      </div>
      <button type="button" className="wb-primary" disabled={disabled} onClick={onCheck}>
        Check action
      </button>
      {disabled ? <p className="wb-help">Apply a valid policy draft to enable checks.</p> : null}
      {error === null ? null : (
        <p className="wb-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

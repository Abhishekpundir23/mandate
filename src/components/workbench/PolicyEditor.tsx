import { useId, useState } from 'react';
import type { PolicyDiagnostic } from '../../policy/diagnostics';
import { policyTemplates } from '../../policy/templates';
import { PolicyDiagnostics } from './PolicyDiagnostics';

interface Props {
  readonly value: string;
  readonly appliedPolicyId: string;
  readonly dirty: boolean;
  readonly diagnostics: readonly PolicyDiagnostic[];
  readonly notice: string;
  readonly onEdit: (text: string) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly onTemplate: (id: string) => void;
}

export function PolicyEditor(props: Props) {
  const prefix = useId();
  const [template, setTemplate] = useState('draft-only');
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <div className="wb-section-heading">
        <div>
          <h3 id={prefix + '-title'}>Policy document</h3>
          <p>Applied policy: {props.appliedPolicyId}</p>
        </div>
        <span className={props.dirty ? 'wb-badge wb-badge-warning' : 'wb-badge'}>
          {props.dirty ? 'Unapplied draft' : 'Applied'}
        </span>
      </div>
      <div className="wb-toolbar">
        <label htmlFor={prefix + '-template'}>
          Policy template
          <select
            id={prefix + '-template'}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            {policyTemplates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => props.onTemplate(template)}>
          Load template
        </button>
      </div>
      <label className="wb-editor-label" htmlFor={prefix + '-json'}>
        Policy JSON
      </label>
      <p id={prefix + '-help'} className="wb-help">
        Paste a policy or edit this draft. Apply validates the complete history. A changed policy
        starts a new session.
      </p>
      <textarea
        id={prefix + '-json'}
        className="wb-json-editor"
        value={props.value}
        maxLength={262144}
        spellCheck={false}
        aria-describedby={prefix + '-help'}
        aria-invalid={props.diagnostics.length > 0}
        onChange={(event) => props.onEdit(event.target.value)}
      />
      <div className="wb-toolbar">
        <button className="wb-primary" type="button" onClick={props.onApply}>
          Apply policy
        </button>
        <button
          type="button"
          onClick={props.onReset}
          disabled={!props.dirty && props.diagnostics.length === 0}
        >
          Reset draft
        </button>
      </div>
      <p className="wb-notice" role="status" aria-label="Policy status">
        {props.notice}
      </p>
      <PolicyDiagnostics diagnostics={props.diagnostics} />
    </section>
  );
}

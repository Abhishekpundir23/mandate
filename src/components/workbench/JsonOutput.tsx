import { useId } from 'react';

export function JsonOutput({ label, value, help, rows = 12 }: {
  readonly label: string;
  readonly value: string;
  readonly help?: string;
  readonly rows?: number;
}) {
  const prefix = useId();
  return <div className="wb-json-output">
    <label htmlFor={prefix + '-output'}>{label}</label>
    <p id={prefix + '-help'} className="wb-help">{help ?? 'Read-only JSON. Select the text to copy it into a local file.'}</p>
    <textarea id={prefix + '-output'} value={value} readOnly spellCheck={false} rows={rows}
      className="wb-json-editor" aria-describedby={prefix + '-help'} />
  </div>;
}

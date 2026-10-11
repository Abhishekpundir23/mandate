import type { PolicyDiagnostic } from '../../policy/diagnostics';

export function PolicyDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly PolicyDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="wb-error" role="alert">
      <strong>Policy draft needs attention</strong>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={index}>
            <code>
              {diagnostic.code} · {diagnostic.path}
            </code>
            <p>{diagnostic.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

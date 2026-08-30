import type { Clause } from '../../domain/types';

interface AuthorityMatrixProps {
  readonly clauses: readonly Clause[];
  readonly version: number;
  readonly flagship: boolean;
}

const representativeIds = [
  'save-draft-must',
  'inspect-next-step-may',
  'submit-must-not',
  'draft-evidence',
] as const;

function displayStatement(clause: Clause): string {
  if (clause.id === 'save-draft-must') return 'Save a draft';
  if (clause.id === 'inspect-next-step-may') return 'Inspect next step';
  if (clause.id === 'submit-must-not') return 'Submit application';
  if (clause.id === 'draft-evidence') return 'Draft preservation';
  return clause.statement;
}

export function AuthorityMatrix({ clauses, version, flagship }: AuthorityMatrixProps) {
  const rows = flagship
    ? representativeIds.flatMap((id) => clauses.filter((clause) => clause.id === id))
    : clauses.filter(({ kind }) => kind !== 'EVIDENCE').slice(0, 4);
  return (
    <div className="authority-matrix">
      <h2>Active authority · v{version}</h2>
      <dl>
        {rows.map((clause) => (
          <div key={clause.id} className={`authority-row authority-${clause.kind.toLowerCase().replace('_', '-')}`}>
            <dt>{clause.kind.replace('_', ' ')}</dt>
            <dd>{flagship ? displayStatement(clause) : clause.statement}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import { useId, useState } from 'react';

import type { Clause, ContractVersion, IntentDiff } from '../../domain/types';

interface MandateHistoryProps {
  readonly versions: readonly ContractVersion[];
  readonly changes: readonly IntentDiff[];
  readonly activeClauses: readonly Clause[];
  readonly flagship: boolean;
}

interface DiffLine {
  readonly text: string;
  readonly kind: 'allowed' | 'denied' | 'unchanged';
}

function sentenceCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

function flagshipDiff(change: IntentDiff): readonly DiffLine[] {
  return change.ops.flatMap((operation): readonly DiffLine[] => {
    if (operation.op !== 'ADD') return [];
    if (operation.clause.id === 'inspect-next-step-may') {
      return [{ text: '+ Inspect the next-step state', kind: 'allowed' as const }];
    }
    if (operation.clause.id === 'submit-must-not') {
      return [{ text: '− Submit application', kind: 'denied' as const }];
    }
    return [];
  });
}

function genericDiff(change: IntentDiff): readonly DiffLine[] {
  return change.ops.map((operation): DiffLine => {
    if (operation.op === 'NO_CHANGE') {
      return {
        text: `No authority change · ${sentenceCase(operation.reason)}`,
        kind: 'unchanged',
      };
    }
    if (operation.op === 'ADD') {
      return {
        text: `+ ${operation.clause.kind.replace('_', ' ')} · ${operation.clause.statement}`,
        kind: operation.clause.kind === 'MUST_NOT' ? 'denied' : 'allowed',
      };
    }
    if (operation.op === 'REVOKE') {
      return { text: `− REVOKED · ${operation.tombstone.statement}`, kind: 'denied' };
    }
    return {
      text: `± ${operation.replacement.kind.replace('_', ' ')} · ${operation.replacement.statement}`,
      kind: 'allowed',
    };
  });
}

function displayClause(clause: Clause): string {
  if (clause.id === 'inspect-next-step-may') return 'Inspect next step';
  if (clause.id === 'submit-must-not') return 'Submit application';
  return clause.statement;
}

export function MandateHistory({
  versions,
  changes,
  activeClauses,
  flagship,
}: MandateHistoryProps) {
  const [expanded, setExpanded] = useState(true);
  const detailId = useId();
  const compactClauses = activeClauses.filter(({ kind }) =>
    kind === 'MAY' || kind === 'MUST_NOT');

  return (
    <aside className="history-rail" aria-labelledby="history-heading">
      <h2 id="history-heading">Mandate history</h2>
      <ol className="version-list">
        {versions.map((version, index) => {
          const current = index === versions.length - 1;
          const change = changes.find(({ turnId }) => turnId === version.turnId);
          const details = change === undefined
            ? []
            : flagship ? flagshipDiff(change) : genericDiff(change);
          return (
            <li key={version.hash} className={current ? 'version-current' : 'version-previous'}>
              <span className="version-node" aria-hidden="true" />
              {current ? (
                <div className="version-disclosure">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    aria-label={`v${version.version} ${version.source.quote}`}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    <span className="version-number">v{version.version}</span>
                    <span>{version.source.quote}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={expanded ? 'M5 15l7-7 7 7' : 'M9 5l7 7-7 7'} />
                    </svg>
                  </button>
                  <div id={detailId} className="version-diff" hidden={!expanded}>
                    {details.map((detail) => (
                      <p key={detail.text} className={`diff-${detail.kind}`}>{detail.text}</p>
                    ))}
                  </div>
                  {compactClauses.length === 0 ? null : (
                    <section
                      className="compact-current-authority"
                      aria-label="Current authority summary"
                    >
                      <h3>Current authority</h3>
                      <dl>
                        {compactClauses.map((clause) => (
                          <div key={clause.id} className={`compact-authority-${clause.kind.toLowerCase().replace('_', '-')}`}>
                            <dt>{clause.kind.replace('_', ' ')}</dt>
                            <dd>{displayClause(clause)}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                </div>
              ) : (
                <div className="version-summary">
                  <span className="version-number">v{version.version}</span>
                  <p>{version.source.quote}</p>
                  {details.map((detail) => (
                    <p key={detail.text} className={`diff-${detail.kind}`}>{detail.text}</p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

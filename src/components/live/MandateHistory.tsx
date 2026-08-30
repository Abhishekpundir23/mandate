import { useId, useState } from 'react';

import type { ContractVersion } from '../../domain/types';

interface MandateHistoryProps {
  readonly versions: readonly ContractVersion[];
  readonly flagship: boolean;
}

function versionDetail(version: number): string | undefined {
  if (version === 2) return '+ Inspect the next-step state';
  if (version === 3) return '− Submit application';
  return undefined;
}

export function MandateHistory({ versions, flagship }: MandateHistoryProps) {
  const [expanded, setExpanded] = useState(true);
  const detailId = useId();

  return (
    <aside className="history-rail" aria-labelledby="history-heading">
      <h2 id="history-heading">Mandate history</h2>
      <ol className="version-list">
        {versions.map((version) => {
          const current = version.version === versions.length;
          const detail = flagship ? versionDetail(version.version) : undefined;
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
                  {expanded ? (
                    <div id={detailId} className="version-diff">
                      {detail === undefined ? null : <p className="diff-denied">{detail}</p>}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="version-summary">
                  <span className="version-number">v{version.version}</span>
                  <p>{version.source.quote}</p>
                  {detail === undefined ? null : <p className="diff-allowed">{detail}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

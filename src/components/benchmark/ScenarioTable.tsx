import { useMemo, useState } from 'react';

import type { BenchmarkRow } from '../../benchmark/snapshot';
import { StatusIcon } from '../primitives/StatusIcon';

type SortKey = 'title' | 'domain' | 'standard' | 'mandate' | 'failure';
type SortDirection = 'ascending' | 'descending';

interface ScenarioTableProps {
  readonly rows: readonly BenchmarkRow[];
  readonly selectedScenarioId: string;
  readonly resultRangeLabel: string;
  readonly onActivate: (scenarioId: string) => void;
}

const headers: readonly { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Scenario' },
  { key: 'domain', label: 'Domain' },
  { key: 'standard', label: 'Standard' },
  { key: 'mandate', label: 'Mandate' },
  { key: 'failure', label: 'Failure caught' },
];

function sortValue(row: BenchmarkRow, key: SortKey): string | number {
  if (key === 'title') return row.title;
  if (key === 'domain') return row.domain;
  if (key === 'standard') return row.standardStatus.rank;
  if (key === 'mandate') return row.mandateStatus.rank;
  return row.failureCategory;
}

function compare(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function RowStatus({ status }: { readonly status: BenchmarkRow['standardStatus'] }) {
  return (
    <span className={`benchmark-status status-${status.tone}`}>
      {status.tone === 'pass' ? <StatusIcon kind="success" size={22} /> : (
        <svg className="status-icon" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <circle cx="16" cy="16" r="12" />
          <path d="m11 11 10 10M21 11 11 21" />
        </svg>
      )}
      {status.label}
    </span>
  );
}

export function ScenarioTable({
  rows,
  selectedScenarioId,
  resultRangeLabel,
  onActivate,
}: ScenarioTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>();
  const orderedRows = useMemo(() => {
    if (sort === undefined) return rows;
    const direction = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const result = compare(sortValue(left, sort.key), sortValue(right, sort.key));
      return result === 0 ? left.originalIndex - right.originalIndex : result * direction;
    });
  }, [rows, sort]);

  const changeSort = (key: SortKey): void => {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === 'ascending'
        ? 'descending'
        : 'ascending',
    }));
  };

  return (
    <section className="scenario-results" aria-labelledby="scenario-results-title">
      <h2 id="scenario-results-title">Scenario results</h2>
      <div className="scenario-table-scroll">
        <table aria-label="Scenario results">
          <thead>
            <tr>
              {headers.map(({ key, label }) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={sort?.key === key ? sort.direction : 'none'}
                >
                  <button type="button" onClick={() => changeSort(key)} aria-label={`Sort by ${label}`}>
                    {label}
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="m5 6 3-3 3 3M11 10l-3 3-3-3" />
                    </svg>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const selected = row.id === selectedScenarioId;
              return (
                <tr key={row.id} aria-selected={selected} className={selected ? 'selected' : undefined}>
                  <td className="scenario-name">
                    <button
                      type="button"
                      aria-label={`Select ${row.title}`}
                      onClick={() => onActivate(row.id)}
                    >
                      <span>{row.title}</span>
                      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                        <path d="m6 3 5 5-5 5" />
                      </svg>
                    </button>
                  </td>
                  <td>{row.domain}</td>
                  <td><RowStatus status={row.standardStatus} /></td>
                  <td><RowStatus status={row.mandateStatus} /></td>
                  <td>{row.failureCategory}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="scenario-range">{resultRangeLabel}</p>
    </section>
  );
}

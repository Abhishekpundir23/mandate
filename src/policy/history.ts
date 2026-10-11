import type { Clause, ClauseKind, SourceRef } from '../domain/types';
import { activeClauses } from '../mandate/ledger';
import { freezeData } from './freeze';
import type { AuthoritySnapshot } from './types';

export type ClauseCounts = Readonly<Record<ClauseKind, number>>;
export interface VersionInspection {
  readonly version: number;
  readonly parentVersion: number | null;
  readonly turnId: string;
  readonly source: SourceRef;
  readonly hash: string;
  readonly clauses: readonly Clause[];
  readonly activeClauses: readonly Clause[];
  readonly introducedClauseIds: readonly string[];
  readonly retiredClauseIds: readonly string[];
  readonly counts: ClauseCounts;
}

export function countClauseKinds(clauses: readonly Clause[]): ClauseCounts {
  return freezeData({
    MAY: clauses.filter((clause) => clause.kind === 'MAY').length,
    MUST: clauses.filter((clause) => clause.kind === 'MUST').length,
    MUST_NOT: clauses.filter((clause) => clause.kind === 'MUST_NOT').length,
    NEEDS_CONFIRMATION: clauses.filter((clause) => clause.kind === 'NEEDS_CONFIRMATION').length,
    REVOKED: clauses.filter((clause) => clause.kind === 'REVOKED').length,
    EVIDENCE: clauses.filter((clause) => clause.kind === 'EVIDENCE').length,
  });
}

export function inspectVersion(snapshot: AuthoritySnapshot, number: number): VersionInspection {
  const version = snapshot.versions.find((item) => item.version === number);
  if (version === undefined || !Number.isSafeInteger(number))
    throw new Error('Unknown policy version');
  const active = [...activeClauses(version)].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(active.map((item) => item.id));
  return freezeData({
    version: version.version,
    parentVersion: version.parentVersion,
    turnId: version.turnId,
    source: version.source,
    hash: version.hash,
    clauses: version.clauses,
    activeClauses: active,
    introducedClauseIds: version.clauses
      .filter((item) => item.introducedIn === number)
      .map((item) => item.id)
      .sort(),
    retiredClauseIds: version.clauses
      .filter((item) => !ids.has(item.id))
      .map((item) => item.id)
      .sort(),
    counts: countClauseKinds(active),
  });
}

export function listPolicyHistory(snapshot: AuthoritySnapshot): readonly VersionInspection[] {
  return freezeData(snapshot.versions.map((version) => inspectVersion(snapshot, version.version)));
}

import type { Clause } from '../domain/types';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from './freeze';
import { inspectVersion } from './history';
import type { AuthoritySnapshot } from './types';

export interface VersionComparison {
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly authorityChanged: boolean;
  readonly sourceChanged: boolean;
  readonly activated: readonly Clause[];
  readonly retired: readonly Clause[];
  readonly unchanged: readonly Clause[];
  readonly appended: readonly Clause[];
}

export function compareVersions(
  snapshot: AuthoritySnapshot,
  before: number,
  after: number,
): VersionComparison {
  const left = inspectVersion(snapshot, before);
  const right = inspectVersion(snapshot, after);
  const leftActive = new Set(left.activeClauses.map((item) => item.id));
  const rightActive = new Set(right.activeClauses.map((item) => item.id));
  const leftAll = new Set(left.clauses.map((item) => item.id));
  const activated = right.activeClauses.filter((item) => !leftActive.has(item.id));
  const retired = left.activeClauses.filter((item) => !rightActive.has(item.id));
  return freezeData({
    beforeVersion: before,
    afterVersion: after,
    authorityChanged: activated.length > 0 || retired.length > 0,
    sourceChanged:
      canonicalize(normalizeJsonValue(left.source)) !==
      canonicalize(normalizeJsonValue(right.source)),
    activated,
    retired,
    unchanged: right.activeClauses.filter((item) => leftActive.has(item.id)),
    appended: right.clauses
      .filter((item) => !leftAll.has(item.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

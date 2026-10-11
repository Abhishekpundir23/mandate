import type { ActionSelector, Clause } from '../domain/types';
import { activeClauses, isTombstoneRetirement } from '../mandate/ledger';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from './freeze';
import { countClauseKinds, type ClauseCounts } from './history';
import type { AuthoritySnapshot } from './types';

const capabilities = Object.freeze([
  { tool: 'workspace', operation: 'readFile', effect: 'READ' },
  { tool: 'git', operation: 'commit', effect: 'LOCAL_PERSIST' },
  { tool: 'git', operation: 'push', effect: 'EXTERNAL_TRANSMIT' },
]);

function supported(selector: ActionSelector) {
  return capabilities.filter(
    (candidate) =>
      (selector.tool === undefined || selector.tool === candidate.tool) &&
      (selector.operation === undefined || selector.operation === candidate.operation) &&
      (selector.effect === undefined || selector.effect === candidate.effect),
  );
}

export function selectorsOverlap(left: ActionSelector, right: ActionSelector): boolean {
  if (
    left.resource !== undefined &&
    right.resource !== undefined &&
    left.resource !== right.resource
  )
    return false;
  const candidates = supported(left);
  return supported(right).some((rightCapability) =>
    candidates.some((leftCapability) => leftCapability.operation === rightCapability.operation),
  );
}

export function selectorIncludes(broad: ActionSelector, narrow: ActionSelector): boolean {
  if (broad.resource !== undefined && broad.resource !== narrow.resource) return false;
  const left = supported(broad);
  const right = supported(narrow);
  return (
    right.length > 0 &&
    right.every((candidate) => left.some((item) => item.operation === candidate.operation))
  );
}

export interface PolicyIssue {
  readonly code:
    | 'DENIAL_OVERRIDES_GRANT'
    | 'UNREACHABLE_GRANT'
    | 'REDUNDANT_AUTHORITY'
    | 'CONFIRMATION_REQUIRED'
    | 'EMPTY_AUTHORITY'
    | 'EVIDENCE_TARGET_INACTIVE';
  readonly severity: 'info' | 'warning';
  readonly clauseIds: readonly string[];
  readonly message: string;
}
export interface PolicyAnalysis {
  readonly contractVersion: number;
  readonly activeClauseCount: number;
  readonly counts: ClauseCounts;
  readonly issues: readonly PolicyIssue[];
  readonly truncated: boolean;
}

function effectiveSelectors(
  clause: Clause,
  snapshot: AuthoritySnapshot,
): readonly ActionSelector[] {
  if (clause.kind !== 'REVOKED') return clause.selector === undefined ? [] : [clause.selector];
  if (isTombstoneRetirement(clause, snapshot.current)) return [];
  const targets = new Set(clause.targetClauseIds ?? []);
  return [
    ...(clause.revokedSelector === undefined ? [] : [clause.revokedSelector]),
    ...snapshot.current.clauses
      .filter((item) => targets.has(item.id) && item.selector !== undefined)
      .map((item) => item.selector!),
  ];
}

export function analyzePolicy(snapshot: AuthoritySnapshot): PolicyAnalysis {
  const clauses = activeClauses(snapshot.current);
  const ids = new Set(clauses.map((clause) => clause.id));
  const grants = clauses.filter((clause) => clause.kind === 'MAY' || clause.kind === 'MUST');
  const issues: PolicyIssue[] = [];
  let truncated = false;
  const add = (issue: PolicyIssue): void => {
    if (issues.length < 200) issues.push(issue);
    else truncated = true;
  };
  if (grants.length === 0)
    add({
      code: 'EMPTY_AUTHORITY',
      severity: 'info',
      clauseIds: [],
      message: 'No active grant; unmatched actions are blocked.',
    });
  for (const clause of clauses) {
    if (
      clause.kind === 'EVIDENCE' &&
      clause.evidenceRequirement !== undefined &&
      !ids.has(clause.evidenceRequirement.forClauseId)
    ) {
      add({
        code: 'EVIDENCE_TARGET_INACTIVE',
        severity: 'warning',
        clauseIds: [clause.id, clause.evidenceRequirement.forClauseId],
        message: 'Evidence refers to a clause that is no longer active.',
      });
    }
  }
  for (let index = 0; index < clauses.length; index += 1) {
    const left = clauses[index]!;
    for (const right of clauses.slice(index + 1)) {
      if (
        left.kind === right.kind &&
        left.kind !== 'EVIDENCE' &&
        canonicalize(
          normalizeJsonValue({
            selector: left.selector ?? null,
            revokedSelector: left.revokedSelector ?? null,
            afterConfirmation: left.afterConfirmation ?? null,
          }),
        ) ===
          canonicalize(
            normalizeJsonValue({
              selector: right.selector ?? null,
              revokedSelector: right.revokedSelector ?? null,
              afterConfirmation: right.afterConfirmation ?? null,
            }),
          )
      ) {
        add({
          code: 'REDUNDANT_AUTHORITY',
          severity: 'info',
          clauseIds: [left.id, right.id].sort(),
          message: 'Same-kind clauses describe the same selector.',
        });
      }
    }
  }
  for (const grant of grants) {
    if (grant.selector === undefined) continue;
    for (const boundary of clauses) {
      if (
        boundary.kind !== 'MUST_NOT' &&
        boundary.kind !== 'REVOKED' &&
        boundary.kind !== 'NEEDS_CONFIRMATION'
      )
        continue;
      const selectors = effectiveSelectors(boundary, snapshot);
      if (!selectors.some((selector) => selectorsOverlap(grant.selector!, selector))) continue;
      const pair = [grant.id, boundary.id].sort();
      if (boundary.kind === 'NEEDS_CONFIRMATION') {
        add({
          code: 'CONFIRMATION_REQUIRED',
          severity: 'info',
          clauseIds: pair,
          message: 'Overlapping actions still require action-bound confirmation.',
        });
      } else {
        add({
          code: 'DENIAL_OVERRIDES_GRANT',
          severity: 'warning',
          clauseIds: pair,
          message: 'Denial takes precedence where these selectors overlap.',
        });
        if (selectors.some((selector) => selectorIncludes(selector, grant.selector!))) {
          add({
            code: 'UNREACHABLE_GRANT',
            severity: 'warning',
            clauseIds: pair,
            message: 'The active denial covers this entire grant.',
          });
        }
      }
    }
  }
  return freezeData({
    contractVersion: snapshot.current.version,
    activeClauseCount: clauses.length,
    counts: countClauseKinds(clauses),
    issues,
    truncated,
  });
}

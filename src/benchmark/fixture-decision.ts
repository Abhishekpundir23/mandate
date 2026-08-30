import { fingerprintAction } from '../domain/canonical';
import type {
  ActionProposal,
  ActionSelector,
  Clause,
  ContractVersion,
  GateDecision,
} from '../domain/types';
import { activeClauses } from '../mandate/ledger';

function selectorMatches(action: ActionProposal, selector: ActionSelector | undefined): boolean {
  return selector !== undefined
    && (selector.tool === undefined || selector.tool === action.tool)
    && (selector.operation === undefined || selector.operation === action.operation)
    && (selector.resource === undefined || selector.resource === action.resource)
    && (selector.effect === undefined || selector.effect === action.effect);
}

function denialMatches(action: ActionProposal, clause: Clause, version: ContractVersion): boolean {
  if (clause.kind === 'MUST_NOT') return selectorMatches(action, clause.selector);
  if (selectorMatches(action, clause.revokedSelector)) return true;
  const targets = new Set(clause.targetClauseIds ?? []);
  return version.clauses.some((candidate) =>
    targets.has(candidate.id) && selectorMatches(action, candidate.selector));
}

/** Derive the gate payload only from fixture-owned authority and the canonical action. */
export function expectedMandateDecision(
  action: ActionProposal,
  version: ContractVersion,
): GateDecision {
  const matching = activeClauses(version).filter((clause) =>
    clause.kind === 'REVOKED'
      ? denialMatches(action, clause, version)
      : selectorMatches(action, clause.selector));
  const denials = matching.filter(({ kind }) => kind === 'MUST_NOT' || kind === 'REVOKED');
  const grants = matching.filter(({ kind }) => kind === 'MUST' || kind === 'MAY');
  const confirmations = matching.filter(({ kind }) => kind === 'NEEDS_CONFIRMATION');
  let outcome: GateDecision['outcome'];
  let reasons: readonly string[];
  if (denials.length > 0) {
    outcome = 'BLOCK';
    reasons = [
      ...(denials.some(({ kind }) => kind === 'MUST_NOT') ? ['Denied by active MUST_NOT authority'] : []),
      ...(denials.some(({ kind }) => kind === 'REVOKED') ? ['Denied by active REVOKED authority'] : []),
      ...(grants.length > 0 ? ['Conflicting authority: denial wins'] : []),
    ];
  } else if (confirmations.some(({ afterConfirmation }) =>
    afterConfirmation !== 'MAY' && afterConfirmation !== 'MUST')) {
    outcome = 'BLOCK';
    reasons = ['Malformed confirmation authority: blocked closed'];
  } else if (confirmations.length > 0) {
    outcome = 'CONFIRM';
    reasons = ['Action-bound confirmation required'];
  } else if (grants.length > 0) {
    outcome = 'ALLOW';
    reasons = ['Matching active authority'];
  } else {
    outcome = 'BLOCK';
    reasons = ['No matching authority'];
  }
  return {
    outcome,
    contractVersion: version.version,
    actionFingerprint: fingerprintAction(action),
    matchedClauseIds: [...new Set(matching.map(({ id }) => id))].sort(),
    reasons: [...new Set(reasons)].sort(),
  };
}

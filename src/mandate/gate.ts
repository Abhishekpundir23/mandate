import { checksum, normalizeJsonValue } from '../domain/canonical';
import type {
  ActionProposal,
  ActionSelector,
  Clause,
  ConfirmationToken,
  ContractVersion,
  Effect,
  GateDecision,
  JsonValue,
} from '../domain/types';
import { activeClauses } from './ledger';

const effects = new Set<Effect>([
  'READ',
  'DRAFT_WRITE',
  'LOCAL_PERSIST',
  'EXTERNAL_TRANSMIT',
  'PUBLISH',
  'DESTRUCTIVE',
]);

const identifierPattern = /^[\p{L}_][\p{L}\p{N}._:-]*$/u;
const compoundOperationPattern = /(?:[\p{Ll}\p{N}](?:And|Then)[\p{Lu}\p{N}])|(?:^|[._:-])(?:and|then)(?:[._:-]|$)|[+&,;/]/u;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function normalizeText(value: string, field: string): string {
  const normalized = value.normalize('NFC').trim();
  if (normalized.length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
  return normalized;
}

function normalizeIdentifier(value: string, field: string): string {
  const normalized = normalizeText(value, field);
  if (!identifierPattern.test(normalized)) {
    throw new TypeError(`${field} is malformed.`);
  }
  return normalized;
}

function normalizeEffect(value: string): Effect {
  const normalized = normalizeText(value, 'effect').toUpperCase();
  if (!effects.has(normalized as Effect)) {
    throw new TypeError('effect is unknown.');
  }
  return normalized as Effect;
}

function actionPayload(proposal: ActionProposal): JsonValue {
  const args = normalizeJsonValue(proposal.args);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('args must be a plain JSON object.');
  }

  return {
    tool: normalizeIdentifier(proposal.tool, 'tool'),
    operation: normalizeIdentifier(proposal.operation, 'operation'),
    args,
    effect: normalizeEffect(proposal.effect),
    resource: normalizeText(proposal.resource, 'resource'),
  };
}

function normalizeProposal(proposal: ActionProposal): Readonly<ActionProposal> {
  const payload = actionPayload(proposal) as {
    readonly tool: string;
    readonly operation: string;
    readonly args: Readonly<Record<string, JsonValue>>;
    readonly effect: Effect;
    readonly resource: string;
  };
  const normalized = {
    id: normalizeText(proposal.id, 'id'),
    stepId: normalizeText(proposal.stepId, 'stepId'),
    ...payload,
    fingerprint: checksum(payload),
  } satisfies ActionProposal;
  return deepFreeze(normalized) as Readonly<ActionProposal>;
}

export function fingerprintAction(proposal: ActionProposal): string {
  return checksum(actionPayload(proposal));
}

function normalizeSelector(selector: ActionSelector): ActionSelector {
  return {
    ...(selector.tool === undefined ? {} : { tool: normalizeIdentifier(selector.tool, 'selector.tool') }),
    ...(selector.operation === undefined
      ? {}
      : { operation: normalizeIdentifier(selector.operation, 'selector.operation') }),
    ...(selector.resource === undefined ? {} : { resource: normalizeText(selector.resource, 'selector.resource') }),
    ...(selector.effect === undefined ? {} : { effect: normalizeEffect(selector.effect) }),
  };
}

function selectorMatches(proposal: Readonly<ActionProposal>, selector: ActionSelector | undefined): boolean {
  if (selector === undefined) {
    return false;
  }
  const normalized = normalizeSelector(selector);
  return (normalized.tool === undefined || normalized.tool === proposal.tool)
    && (normalized.operation === undefined || normalized.operation === proposal.operation)
    && (normalized.resource === undefined || normalized.resource === proposal.resource)
    && (normalized.effect === undefined || normalized.effect === proposal.effect);
}

function revocationMatches(
  proposal: Readonly<ActionProposal>,
  tombstone: Clause,
  version: ContractVersion,
): boolean {
  if (selectorMatches(proposal, tombstone.revokedSelector)) {
    return true;
  }
  const targetIds = new Set(tombstone.targetClauseIds ?? []);
  return version.clauses.some((candidate) =>
    targetIds.has(candidate.id) && selectorMatches(proposal, candidate.selector));
}

function validConfirmation(
  confirmation: ConfirmationToken | undefined,
  version: ContractVersion,
  proposal: Readonly<ActionProposal>,
): boolean {
  const expectedId = confirmation === undefined
    ? ''
    : `confirmation-${checksum({
        contractVersion: confirmation.contractVersion,
        actionFingerprint: confirmation.actionFingerprint,
        issuedAtLogicalStep: confirmation.issuedAtLogicalStep,
      })}`;
  return confirmation !== undefined
    && confirmation.id === expectedId
    && confirmation.contractVersion === version.version
    && confirmation.actionFingerprint === proposal.fingerprint
    && confirmation.issuedAtLogicalStep === proposal.stepId;
}

function decision(
  outcome: GateDecision['outcome'],
  contractVersion: number,
  actionFingerprint: string,
  matchedClauseIds: readonly string[],
  reasons: readonly string[],
): GateDecision {
  return deepFreeze({
    outcome,
    contractVersion,
    actionFingerprint,
    matchedClauseIds: [...new Set(matchedClauseIds)].sort(),
    reasons: [...new Set(reasons)].sort(),
  }) as GateDecision;
}

function invalidFingerprint(proposal: ActionProposal): string {
  return `invalid-${checksum({
    id: String(proposal.id),
    stepId: String(proposal.stepId),
    tool: String(proposal.tool),
    operation: String(proposal.operation),
    effect: String(proposal.effect),
    resource: String(proposal.resource),
  })}`;
}

export function evaluateAction(
  version: ContractVersion,
  proposal: ActionProposal,
  confirmation?: ConfirmationToken,
): GateDecision {
  let normalized: Readonly<ActionProposal>;
  try {
    normalized = normalizeProposal(proposal);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Malformed action proposal.';
    return decision('BLOCK', version.version, invalidFingerprint(proposal), [], [reason]);
  }

  if (compoundOperationPattern.test(normalized.operation)) {
    return decision('BLOCK', version.version, normalized.fingerprint, [], [
      'Composite operations are not allowed',
    ]);
  }

  const matches: Clause[] = [];
  const malformedDenials: Clause[] = [];
  for (const clause of activeClauses(version)) {
    try {
      if (clause.kind === 'REVOKED'
        ? revocationMatches(normalized, clause, version)
        : selectorMatches(normalized, clause.selector)) {
        matches.push(clause);
      }
    } catch {
      if (clause.kind === 'MUST_NOT' || clause.kind === 'REVOKED') {
        malformedDenials.push(clause);
      }
    }
  }

  if (malformedDenials.length > 0) {
    return decision('BLOCK', version.version, normalized.fingerprint, malformedDenials.map(({ id }) => id), [
      'Malformed denial authority: blocked closed',
    ]);
  }

  const denials = matches.filter(({ kind }) => kind === 'MUST_NOT' || kind === 'REVOKED');
  const grants = matches.filter(({ kind }) => kind === 'MUST' || kind === 'MAY');
  const confirmations = matches.filter(({ kind }) => kind === 'NEEDS_CONFIRMATION');
  const matchedClauseIds = matches.map(({ id }) => id);

  if (denials.length > 0) {
    const reasons = [
      ...(denials.some(({ kind }) => kind === 'MUST_NOT') ? ['Denied by active MUST_NOT authority'] : []),
      ...(denials.some(({ kind }) => kind === 'REVOKED') ? ['Denied by active REVOKED authority'] : []),
      ...(grants.length > 0 ? ['Conflicting authority: denial wins'] : []),
    ];
    return decision('BLOCK', version.version, normalized.fingerprint, matchedClauseIds, reasons);
  }

  if (confirmations.length > 0) {
    if (validConfirmation(confirmation, version, normalized)) {
      return decision('ALLOW', version.version, normalized.fingerprint, matchedClauseIds, [
        'Action-bound confirmation accepted',
      ]);
    }
    return decision('CONFIRM', version.version, normalized.fingerprint, matchedClauseIds, [
      'Action-bound confirmation required',
    ]);
  }

  if (grants.length > 0) {
    return decision('ALLOW', version.version, normalized.fingerprint, matchedClauseIds, [
      'Matching active authority',
    ]);
  }

  return decision('BLOCK', version.version, normalized.fingerprint, matchedClauseIds, [
    'No matching authority',
  ]);
}

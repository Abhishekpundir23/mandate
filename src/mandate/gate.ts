import {
  checksum,
  fingerprintAction,
  normalizeActionPayload,
} from '../domain/canonical';
import type {
  ActionProposal,
  ActionSelector,
  CapabilityValidationProposal,
  Clause,
  ContractVersion,
  Effect,
  GateDecision,
  GateEvaluation,
  GateRequest,
} from '../domain/types';
import { consumeConfirmation } from './confirmation';
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

type NormalizedProposal = Readonly<ActionProposal> & CapabilityValidationProposal;

function normalizeProposal(proposal: ActionProposal): NormalizedProposal {
  const payload = normalizeActionPayload(proposal);
  const normalized = {
    id: normalizeText(proposal.id, 'id'),
    stepId: normalizeText(proposal.stepId, 'stepId'),
    ...payload,
    fingerprint: checksum(payload),
  } satisfies ActionProposal;
  return deepFreeze(normalized) as NormalizedProposal;
}

export { fingerprintAction };

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

function selectorMatches(proposal: NormalizedProposal, selector: ActionSelector | undefined): boolean {
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
  proposal: NormalizedProposal,
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

function evaluation(
  gateDecision: GateDecision,
  confirmationStore: GateRequest['confirmationStore'],
): GateEvaluation {
  return Object.freeze({ decision: gateDecision, confirmationStore });
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

function readExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }

  const ownKeys = [...Object.getOwnPropertyNames(value), ...Object.getOwnPropertySymbols(value)];
  if (ownKeys.some((key) => typeof key !== 'string')) {
    return undefined;
  }
  const stringKeys = ownKeys as string[];
  if ([...stringKeys].sort().join('\0') !== [...expectedKeys].sort().join('\0')) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const entries: [string, unknown][] = [];
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }
    entries.push([key, descriptor.value]);
  }
  return Object.fromEntries(entries);
}

function readDenseDataArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
    return undefined;
  }
  const length = lengthDescriptor.value as unknown;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    return undefined;
  }

  const expectedKeys = [
    ...Array.from({ length: length as number }, (_, index) => String(index)),
    'length',
  ];
  const ownKeys = [...Object.getOwnPropertyNames(value), ...Object.getOwnPropertySymbols(value)];
  if (ownKeys.some((key) => typeof key !== 'string')) {
    return undefined;
  }
  const stringKeys = ownKeys as string[];
  if ([...stringKeys].sort().join('\0') !== [...expectedKeys].sort().join('\0')) {
    return undefined;
  }

  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }
    result.push(descriptor.value);
  }
  return result;
}

function validateCapability(
  request: GateRequest,
  proposal: NormalizedProposal,
): readonly string[] {
  try {
    const runtimeValidation: unknown = request.validateCapability(proposal);
    const rejection = readExactDataRecord(runtimeValidation, ['ok', 'reason']);
    if (rejection?.ok === false) {
      if (typeof rejection.reason !== 'string') {
        return ['Capability validation failed closed'];
      }
      return [normalizeText(rejection.reason, 'capability validation reason')];
    }

    const success = readExactDataRecord(runtimeValidation, ['ok', 'effects', 'resource']);
    if (success?.ok !== true || typeof success.resource !== 'string') {
      return ['Capability validation failed closed'];
    }
    const declaredEffects = readDenseDataArray(success.effects);
    if (declaredEffects === undefined) {
      return ['Capability validation failed closed'];
    }
    if (declaredEffects.length !== 1) {
      return ['Composite operations are not allowed'];
    }
    const declaredEffect = declaredEffects[0];
    if (typeof declaredEffect !== 'string' || !effects.has(declaredEffect as Effect)) {
      return ['Capability validation failed closed'];
    }
    if (declaredEffect !== proposal.effect) {
      return ['Capability effect does not match proposal effect'];
    }

    const derivedResource = normalizeText(success.resource, 'capability resource');
    if (derivedResource !== proposal.resource) {
      return ['Capability-derived resource does not match proposal resource'];
    }
    return [];
  } catch {
    return ['Capability validation failed closed'];
  }
}

export function evaluateAction(request: GateRequest): GateEvaluation {
  const { version, confirmationStore } = request;
  let normalized: NormalizedProposal;
  try {
    normalized = normalizeProposal(request.proposal);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Malformed action proposal.';
    return evaluation(
      decision('BLOCK', version.version, invalidFingerprint(request.proposal), [], [reason]),
      confirmationStore,
    );
  }

  const capabilityReasons = validateCapability(request, normalized);
  if (capabilityReasons.length > 0) {
    return evaluation(
      decision('BLOCK', version.version, normalized.fingerprint, [], capabilityReasons),
      confirmationStore,
    );
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
    return evaluation(
      decision(
        'BLOCK',
        version.version,
        normalized.fingerprint,
        malformedDenials.map(({ id }) => id),
        ['Malformed denial authority: blocked closed'],
      ),
      confirmationStore,
    );
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
    return evaluation(
      decision('BLOCK', version.version, normalized.fingerprint, matchedClauseIds, reasons),
      confirmationStore,
    );
  }

  if (confirmations.length > 0) {
    const structurallyValid = confirmations.every(({ afterConfirmation }) =>
      afterConfirmation === 'MAY' || afterConfirmation === 'MUST');
    if (!structurallyValid) {
      return evaluation(
        decision(
          'BLOCK',
          version.version,
          normalized.fingerprint,
          matchedClauseIds,
          ['Malformed confirmation authority: blocked closed'],
        ),
        confirmationStore,
      );
    }

    if (request.confirmation !== undefined) {
      const consumed = consumeConfirmation(
        confirmationStore,
        request.confirmation,
        version,
        normalized,
      );
      if (consumed.ok) {
        return evaluation(
          decision('ALLOW', version.version, normalized.fingerprint, matchedClauseIds, [
            'Action-bound confirmation accepted',
          ]),
          consumed.store,
        );
      }
    }
    return evaluation(
      decision('CONFIRM', version.version, normalized.fingerprint, matchedClauseIds, [
        'Action-bound confirmation required',
      ]),
      confirmationStore,
    );
  }

  if (grants.length > 0) {
    return evaluation(
      decision('ALLOW', version.version, normalized.fingerprint, matchedClauseIds, [
        'Matching active authority',
      ]),
      confirmationStore,
    );
  }

  return evaluation(
    decision('BLOCK', version.version, normalized.fingerprint, matchedClauseIds, [
      'No matching authority',
    ]),
    confirmationStore,
  );
}

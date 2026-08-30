import { checksum, normalizeActionPayload } from '../domain/canonical';
import { evaluatePredicate } from '../domain/predicates';
import type {
  ContractVersion,
  JsonValue,
  Predicate,
  Proposal,
  ScenarioDefinition,
  ToolObservation,
} from '../domain/types';
import { appendVersion } from '../mandate/ledger';
import { validateCapability } from '../sandbox/capabilities';
import type { ExecutionObservation } from '../sandbox/execute';
import type { RuntimeEvent } from './runner';

export interface ClaimEvidence {
  readonly verified: boolean;
  readonly evidenceIds: readonly string[];
}
export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
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

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function rootVersion(): ContractVersion {
  return {
    version: 0,
    parentVersion: null,
    turnId: '__root__',
    source: { turnId: '__root__', quote: 'Local deterministic authority root.' },
    clauses: [],
    hash: checksum({ version: 0, clauses: [] }),
  };
}

export function appendCanonicalTurn(
  versions: readonly ContractVersion[],
  turn: ScenarioDefinition['turns'][number],
): readonly ContractVersion[] {
  if (versions.length === 0) {
    return appendVersion([rootVersion()], turn.canonicalDiff).slice(1);
  }
  return appendVersion(versions, turn.canonicalDiff);
}

export function claimEvidence(
  events: readonly RuntimeEvent[],
  world: Readonly<Record<string, JsonValue>>,
  predicates: readonly Predicate[],
): ClaimEvidence {
  const observations = events
    .filter((event) => event.type === 'TOOL_OBSERVATION')
    .map((event) => event.observation)
    .filter((observation): observation is ExecutionObservation | ToolObservation =>
      observation !== undefined && observation.status === 'SUCCEEDED');
  const supportingIds = new Set<string>();

  const verified = predicates.every((predicate) => {
    if (!evaluatePredicate(world, predicate)) {
      return false;
    }
    const supporting = observations.filter((observation) =>
      evaluatePredicate(observation.facts, predicate));
    for (const observation of supporting) {
      supportingIds.add(observation.evidenceId);
    }
    return supporting.length > 0;
  });

  return {
    verified,
    evidenceIds: verified ? [...supportingIds].sort() : [],
  };
}

export function validateStandardProposal(
  proposal: Proposal & { readonly kind: 'ACTION' },
): void {
  const normalized = normalizeActionPayload(proposal.action);
  const result = validateCapability(normalized);
  if (!result.ok) {
    throw new TypeError(result.reason);
  }
  if (result.effects.length !== 1
    || result.effects[0] !== normalized.effect
    || result.resource !== normalized.resource) {
    throw new TypeError('Validated capability does not match the proposal.');
  }
}

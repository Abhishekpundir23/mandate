import { checksum } from '../domain/canonical';
import type { ActionSelector, Clause, ContractVersion, IntentDiff, JsonValue } from '../domain/types';

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

function makeVersion(
  version: number,
  parentVersion: number | null,
  turnId: string,
  clauses: readonly Clause[],
): ContractVersion {
  const payload = { version, parentVersion, turnId, clauses };
  return deepFreeze({ ...payload, hash: checksum(payload as unknown as JsonValue) }) as ContractVersion;
}

function selectorMatches(candidate: ActionSelector | undefined, pattern: ActionSelector): boolean {
  return candidate !== undefined
    && (pattern.tool === undefined || candidate.tool === pattern.tool)
    && (pattern.operation === undefined || candidate.operation === pattern.operation)
    && (pattern.resource === undefined || candidate.resource === pattern.resource)
    && (pattern.effect === undefined || candidate.effect === pattern.effect);
}

export function createLedger(initialClauses: readonly Clause[], turnId: string): readonly ContractVersion[] {
  const clauses = structuredClone(initialClauses) as Clause[];
  return deepFreeze([makeVersion(1, null, turnId, clauses)]);
}

export function appendVersion(
  versions: readonly ContractVersion[],
  diff: IntentDiff,
): readonly ContractVersion[] {
  const latest = versions.at(-1);
  if (latest === undefined) {
    throw new Error('Cannot append to an empty authority ledger.');
  }
  if (diff.baseVersion !== latest.version) {
    throw new Error(`Stale base version ${diff.baseVersion}; current version is ${latest.version}.`);
  }
  if (versions.some((version) => version.turnId === diff.turnId)) {
    throw new Error(`Duplicate source turn: ${diff.turnId}.`);
  }

  const existingClauseIds = new Set(latest.clauses.map((clause) => clause.id));
  for (const operation of diff.ops) {
    const targetIds = operation.op === 'REPLACE'
      ? operation.targetClauseIds
      : operation.op === 'REVOKE'
        ? operation.tombstone.targetClauseIds ?? []
        : [];
    for (const targetId of targetIds) {
      if (!existingClauseIds.has(targetId)) {
        throw new Error(`Target clause ${targetId} does not exist in version ${latest.version}.`);
      }
    }
  }

  const version = latest.version + 1;
  const clauses: Clause[] = [...latest.clauses];
  for (const operation of diff.ops) {
    if (operation.op === 'ADD') {
      clauses.push({ ...structuredClone(operation.clause), introducedIn: version });
    }
    if (operation.op === 'REVOKE') {
      clauses.push({ ...structuredClone(operation.tombstone), introducedIn: version });
    }
    if (operation.op === 'REPLACE') {
      for (const targetId of operation.targetClauseIds) {
        const target = latest.clauses.find((clause) => clause.id === targetId);
        if (target !== undefined) {
          clauses.push({
            id: `${diff.turnId}:revoke:${target.id}`,
            kind: 'REVOKED',
            statement: `Revoked: ${target.statement}`,
            introducedIn: version,
            source: structuredClone(operation.replacement.source),
            targetClauseIds: [target.id],
            ...(target.selector === undefined ? {} : { revokedSelector: structuredClone(target.selector) }),
            ...(operation.replacement.confidence === undefined
              ? {}
              : { confidence: operation.replacement.confidence }),
          });
        }
      }
      clauses.push({ ...structuredClone(operation.replacement), introducedIn: version });
    }
  }

  return deepFreeze([
    ...versions,
    makeVersion(version, latest.version, diff.turnId, clauses),
  ]);
}

export function activeClauses(version: ContractVersion): readonly Clause[] {
  const tombstones = version.clauses.filter((clause) => clause.kind === 'REVOKED');
  const revokedIds = new Set(tombstones.flatMap((clause) => clause.targetClauseIds ?? []));

  return deepFreeze(version.clauses.filter((clause) =>
    clause.kind === 'REVOKED'
    || (!revokedIds.has(clause.id)
      && !tombstones.some((tombstone) =>
        tombstone.revokedSelector !== undefined
        && selectorMatches(clause.selector, tombstone.revokedSelector))),
  ));
}

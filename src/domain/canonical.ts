import type { ActionProposal, Effect, JsonValue } from './types';

const effects = new Set<Effect>([
  'READ',
  'DRAFT_WRITE',
  'LOCAL_PERSIST',
  'EXTERNAL_TRANSMIT',
  'PUBLISH',
  'DESTRUCTIVE',
]);

const identifierPattern = /^[\p{L}_][\p{L}\p{N}._:-]*$/u;

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key]!)]),
    );
  }

  return value;
}

function normalizeUnknown(value: unknown, ancestors: WeakSet<object>, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}.`);
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Non-JSON value at ${path}.`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`Cyclic value at ${path}.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => normalizeUnknown(item, ancestors, `${path}[${index}]`));
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}.`);
    }

    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeUnknown(
          (value as Readonly<Record<string, unknown>>)[key],
          ancestors,
          `${path}.${key}`,
        )]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/** Validate, clone, and recursively key-sort an unknown JSON-compatible value. */
export function normalizeJsonValue(value: unknown): JsonValue {
  return normalizeUnknown(value, new WeakSet<object>(), '$');
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

export interface CanonicalActionPayload extends Readonly<Record<string, JsonValue>> {
  readonly tool: string;
  readonly operation: string;
  readonly args: Readonly<Record<string, JsonValue>>;
  readonly effect: Effect;
  readonly resource: string;
}

export function normalizeActionPayload(proposal: ActionProposal): CanonicalActionPayload {
  const args = normalizeJsonValue(proposal.args);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('args must be a plain JSON object.');
  }

  return {
    tool: normalizeIdentifier(proposal.tool, 'tool'),
    operation: normalizeIdentifier(proposal.operation, 'operation'),
    args: args as Readonly<Record<string, JsonValue>>,
    effect: normalizeEffect(proposal.effect),
    resource: normalizeText(proposal.resource, 'resource'),
  };
}

export function canonicalize(value: JsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

/** A deterministic FNV-1a checksum for local trace identity, not a security primitive. */
export function fnv1aChecksum(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function checksum(value: JsonValue): string {
  return fnv1aChecksum(canonicalize(value));
}

export function fingerprintAction(proposal: ActionProposal): string {
  return checksum(normalizeActionPayload(proposal));
}

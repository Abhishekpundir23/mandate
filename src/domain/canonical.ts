import type { JsonValue } from './types';

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

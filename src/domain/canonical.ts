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

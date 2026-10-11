import { canonicalize } from './canonical';
import type { JsonValue, Predicate } from './types';

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getAtPath(state: JsonValue, path: string): JsonValue | undefined {
  if (path.length === 0) {
    return state;
  }

  let current: JsonValue | undefined = state;
  for (const segment of path.split('.')) {
    if (current === undefined || !isJsonRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function valuesEqual(left: JsonValue, right: JsonValue | undefined): boolean {
  return right !== undefined && canonicalize(left) === canonicalize(right);
}

function uniqueCanonicalValues(values: readonly JsonValue[]): string[] {
  return [...new Set(values.map(canonicalize))].sort();
}

export function evaluatePredicate(state: JsonValue, predicate: Predicate): boolean {
  const actual = getAtPath(state, predicate.path);

  switch (predicate.op) {
    case 'exists':
      return actual !== undefined;
    case 'absent':
      return actual === undefined;
    case 'eq':
      return actual !== undefined && valuesEqual(actual, predicate.value);
    case 'contains':
      if (Array.isArray(actual)) {
        return actual.some((item) => valuesEqual(item, predicate.value));
      }
      return typeof actual === 'string' && typeof predicate.value === 'string' && actual.includes(predicate.value);
    case 'setEquals':
      return Array.isArray(actual)
        && Array.isArray(predicate.value)
        && canonicalize(uniqueCanonicalValues(actual)) === canonicalize(uniqueCanonicalValues(predicate.value));
    case 'lte':
      return typeof actual === 'number' && typeof predicate.value === 'number' && actual <= predicate.value;
  }
}

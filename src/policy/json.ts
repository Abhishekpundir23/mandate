import { normalizeJsonValue } from '../domain/canonical';
import type { JsonValue } from '../domain/types';
import { freezeData } from './freeze';
import { utf8Length } from './utf8';

export interface JsonLimits {
  readonly bytes: number;
  readonly depth: number;
  readonly nodes: number;
}

export const policyJsonLimits: JsonLimits = Object.freeze({ bytes: 256 * 1024, depth: 32, nodes: 20_000 });
export const actionJsonLimits: JsonLimits = Object.freeze({ bytes: 16 * 1024, depth: 8, nodes: 100 });

function validateLimits(limits: JsonLimits): void {
  if (![limits.bytes, limits.depth, limits.nodes].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Invalid JSON limits');
  }
}

function checkData(value: unknown, limits: JsonLimits): void {
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    nodes += 1;
    if (nodes > limits.nodes) throw new TypeError('JSON node limit');
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') { utf8Length(current); continue; }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Non-finite JSON number');
      continue;
    }
    if (typeof current !== 'object') throw new TypeError('Non-JSON value');
    if (item.depth >= limits.depth) throw new TypeError('JSON depth limit');
    if (seen.has(current)) throw new TypeError('Repeated JSON object');
    seen.add(current);
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current) as object | null;
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('JSON plain objects only');
    }
    if (Object.getOwnPropertySymbols(current).length > 0) throw new TypeError('JSON string keys only');
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const names = Object.keys(descriptors);
    if (array) {
      const length = (current as unknown[]).length;
      if (names.length !== length + 1 || names.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
        throw new TypeError('JSON dense arrays only');
      }
    }
    for (const key of names) {
      if (array && key === 'length') continue;
      utf8Length(key);
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) throw new TypeError('JSON data properties only');
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
}

export function normalizeBoundedJson(value: unknown, limits: JsonLimits): JsonValue {
  validateLimits(limits);
  checkData(value, limits);
  const normalized = normalizeJsonValue(value);
  if (utf8Length(JSON.stringify(normalized)) > limits.bytes) throw new TypeError('JSON byte limit');
  return freezeData(normalized);
}

export function parseBoundedJson(text: string, limits: JsonLimits): JsonValue {
  validateLimits(limits);
  if (utf8Length(text) > limits.bytes) throw new TypeError('JSON byte limit');
  // Bound structural depth before invoking recursive normalizers or schemas.
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[' || char === '{') {
      depth += 1;
      if (depth > limits.depth) throw new TypeError('JSON depth limit');
    } else if (char === ']' || char === '}') depth -= 1;
  }
  return normalizeBoundedJson(JSON.parse(text), limits);
}

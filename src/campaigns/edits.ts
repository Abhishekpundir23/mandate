import { z } from '../domain/zod';
import type { JsonValue } from '../domain/types';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson } from '../policy/json';
import { traceBundleLimits } from '../inspection/bundle';
const segment = z.union([z.string().min(1).max(256), z.number().int().min(0).max(10000)]);
const path = z.array(segment).min(1).max(16).refine((parts) => parts.every((part) =>
  part !== '__proto__' && part !== 'constructor' && part !== 'prototype'));
export const editSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('SET'), path, value: z.unknown() })
    .refine((edit) => Object.hasOwn(edit, 'value'), 'SET requires value'),
  z.strictObject({ operation: z.literal('DELETE'), path }),
]);
export type DataEdit = z.infer<typeof editSchema>;
export function applyDataEdits(input: unknown, edits: readonly DataEdit[]): JsonValue {
  let value = normalizeBoundedJson(input, traceBundleLimits);
  const changes = z.array(editSchema).max(8).parse(normalizeBoundedJson(edits, traceBundleLimits));
  for (const edit of changes) {
    const replacement = edit.operation === 'SET' ? normalizeBoundedJson(edit.value, traceBundleLimits) : null;
    function replace(current: JsonValue, index: number): JsonValue {
      const key = edit.path[index]!;
      const last = index === edit.path.length - 1;
      if (Array.isArray(current)) {
        if (typeof key !== 'number' || key >= current.length) throw new Error('Invalid array mutation target');
        if (last && edit.operation === 'DELETE') return current.filter((_item, at) => at !== key);
        return current.map((item, at) => at !== key ? item : last ? replacement : replace(item, index + 1));
      }
      if (current === null || typeof current !== 'object' || typeof key !== 'string') throw new Error('Invalid object mutation target');
      const record = current as Readonly<Record<string, JsonValue>>;
      const present = Object.hasOwn(record, key);
      if (!present && (!last || edit.operation === 'DELETE')) throw new Error('Missing mutation target');
      const entries = Object.entries(record).filter(([name]) => !(last && edit.operation === 'DELETE' && name === key))
        .map(([name, item]) => [name, name !== key ? item : last ? replacement : replace(item, index + 1)]);
      if (!present) entries.push([key, replacement]);
      return Object.fromEntries(entries);
    }
    value = normalizeBoundedJson(replace(value, 0), traceBundleLimits);
  }
  return freezeData(value);
}

import { canonicalize } from '../domain/canonical';
import type { JsonValue } from '../domain/types';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson } from '../policy/json';
import type { WorldChange, WorldDelta } from './types';
const worldLimits = { bytes: 256 * 1024, depth: 32, nodes: 20000 };
function object(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function pointer(key: string) {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
export function compareWorlds(
  before: Readonly<Record<string, JsonValue>>,
  after: Readonly<Record<string, JsonValue>>,
): WorldDelta {
  const left = normalizeBoundedJson(before, worldLimits);
  const right = normalizeBoundedJson(after, worldLimits);
  const changes: WorldChange[] = [];
  let truncated = false;
  function visit(
    a: JsonValue,
    b: JsonValue,
    path: string,
    aPresent: boolean,
    bPresent: boolean,
  ): void {
    if (aPresent && bPresent && canonicalize(a) === canonicalize(b)) return;
    if (aPresent && bPresent && object(a) && object(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        const hasA = Object.hasOwn(a, key);
        const hasB = Object.hasOwn(b, key);
        visit(hasA ? a[key]! : null, hasB ? b[key]! : null, path + '/' + pointer(key), hasA, hasB);
      }
      return;
    }
    if (changes.length >= 500) {
      truncated = true;
      return;
    }
    changes.push({
      path,
      kind: !aPresent ? 'added' : !bPresent ? 'removed' : 'changed',
      beforePresent: aPresent,
      afterPresent: bPresent,
      before: a,
      after: b,
    });
  }
  visit(left, right, '', true, true);
  return freezeData({ changes, truncated });
}

import { describe, expect, test } from 'vitest';
import { parseBoundedJson, normalizeBoundedJson } from './json';

const limits = { bytes: 1024, depth: 4, nodes: 30 };

describe('bounded JSON ingestion', () => {
  test('keeps JSON data and canonicalizes keys without altering array order', () => {
    expect(parseBoundedJson('{"z":[true,null,2],"a":"ok"}', limits))
      .toEqual({ a: 'ok', z: [true, null, 2] });
  });

  test('accepts structural characters inside escaped strings', () => {
    expect(parseBoundedJson('{"x":"[ { \\" ] }"}', limits)).toEqual({ x: '[ { " ] }' });
  });

  test('enforces bytes rather than JavaScript string length', () => {
    expect(parseBoundedJson('"é"', { ...limits, bytes: 4 })).toBe('é');
    expect(() => parseBoundedJson('"é"', { ...limits, bytes: 3 })).toThrow('JSON byte limit');
  });

  test('accepts the exact depth and rejects the next nesting level', () => {
    expect(parseBoundedJson('[[[0]]]', { ...limits, depth: 3 })).toEqual([[[0]]]);
    expect(() => parseBoundedJson('[[[[0]]]]', { ...limits, depth: 3 })).toThrow('JSON depth limit');
  });

  test('counts containers and primitive values against the node budget', () => {
    expect(parseBoundedJson('[1,2]', { ...limits, nodes: 3 })).toEqual([1, 2]);
    expect(() => parseBoundedJson('[1,2,3]', { ...limits, nodes: 3 })).toThrow('JSON node limit');
  });

  test.each(['', '{', '[1,]', 'NaN', 'undefined', '{"x":1e999}', '\ufeff{}']) (
    'rejects malformed or non-finite JSON %j', (text) => {
      expect(() => parseBoundedJson(text, limits)).toThrow();
    },
  );

  test('rejects escaped lone surrogates inside parsed keys and values', () => {
    expect(() => parseBoundedJson('"\\ud800"', limits)).toThrow('Invalid Unicode');
    expect(() => parseBoundedJson('{"\\udfff":1}', limits)).toThrow('Invalid Unicode');
  });

  test('retains own prototype-looking data keys without polluting objects', () => {
    const value = parseBoundedJson('{"__proto__":{"safe":true},"constructor":2}', limits);
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('safe');
  });

  test.each([
    { bytes: 0, depth: 4, nodes: 30 },
    { bytes: 1024, depth: -1, nodes: 30 },
    { bytes: 1024, depth: 4, nodes: 1.5 },
    { bytes: Number.POSITIVE_INFINITY, depth: 4, nodes: 30 },
  ])('rejects invalid caller limits %#', (invalid) => {
    expect(() => parseBoundedJson('0', invalid)).toThrow('Invalid JSON limits');
  });
});

describe('object API data boundary', () => {
  test('rejects accessors without invoking them', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'secret', { enumerable: true, get() { reads += 1; return 'x'; } });
    expect(() => normalizeBoundedJson(input, limits)).toThrow('JSON data properties');
    expect(reads).toBe(0);
  });

  test('rejects non-enumerable properties, symbol keys and custom prototypes', () => {
    expect(() => normalizeBoundedJson(Object.defineProperty({}, 'x', { value: 1 }), limits)).toThrow();
    expect(() => normalizeBoundedJson({ [Symbol('x')]: 1 }, limits)).toThrow();
    expect(() => normalizeBoundedJson(Object.create({ inherited: 1 }), limits)).toThrow();
  });

  test('rejects holes and extra array fields', () => {
    expect(() => normalizeBoundedJson([, 1], limits)).toThrow();
    const input = Object.assign([1], { extra: true });
    expect(() => normalizeBoundedJson(input, limits)).toThrow();
  });

  test('rejects cycles before recursive normalization', () => {
    const input: Record<string, unknown> = {};
    input.self = input;
    expect(() => normalizeBoundedJson(input, limits)).toThrow('Repeated JSON object');
  });

  test('returns an independent immutable data snapshot', () => {
    const input = { nested: { value: 1 } };
    const result = normalizeBoundedJson(input, limits);
    input.nested.value = 9;
    expect(result).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { nested: object }).nested)).toBe(true);
  });
});

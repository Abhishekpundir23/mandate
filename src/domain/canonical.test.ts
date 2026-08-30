import { describe, expect, it } from 'vitest';

import { canonicalize, checksum, normalizeActionPayload, normalizeJsonValue } from './canonical';
import type { ActionProposal } from './types';

describe('canonical values', () => {
  it('produces the same checksum for objects with different key insertion order', () => {
    expect(checksum({ b: 2, a: { y: false, x: true } }))
      .toBe(checksum({ a: { x: true, y: false }, b: 2 }));
  });

  it('changes the checksum when an action argument changes', () => {
    expect(checksum({ tool: 'email.send', recipient: 'Alice' }))
      .not.toBe(checksum({ tool: 'email.send', recipient: 'Bob' }));
  });

  it('sorts nested object keys without changing array order or inputs', () => {
    const input = { steps: [{ z: 2, a: 1 }], name: 'draft' };

    expect(canonicalize(input)).toBe('{"name":"draft","steps":[{"a":1,"z":2}]}');
    expect(input).toEqual({ steps: [{ z: 2, a: 1 }], name: 'draft' });
  });

  it.each([
    ['non-finite number', Number.POSITIVE_INFINITY, /non-finite number/i],
    ['non-JSON primitive', Symbol('unsafe'), /non-json value/i],
    ['non-plain object', new Date(0), /non-plain object/i],
  ] as const)('rejects a %s with its exact JSON path', (_, value, message) => {
    expect(() => normalizeJsonValue({ nested: [value] })).toThrow(message);
  });

  it('rejects cyclic input while allowing the same object in sibling branches', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const shared = { value: 1 };

    expect(() => normalizeJsonValue(cyclic)).toThrow(/cyclic value/i);
    expect(normalizeJsonValue({ left: shared, right: shared })).toEqual({
      left: { value: 1 },
      right: { value: 1 },
    });
  });

  it.each([
    ['empty tool', { tool: ' ' }, /tool must not be empty/i],
    ['malformed operation', { operation: 'send now' }, /operation is malformed/i],
    ['unknown effect', { effect: 'NETWORK' }, /effect is unknown/i],
    ['non-object arguments', { args: [] }, /args must be a plain json object/i],
    ['empty resource', { resource: ' ' }, /resource must not be empty/i],
  ] as const)('rejects %s before canonical action identity is issued', (_, change, message) => {
    const proposal = {
      id: 'action',
      stepId: 'step',
      tool: 'email',
      operation: 'send',
      args: { recipient: 'bob@example.test' },
      effect: 'EXTERNAL_TRANSMIT',
      resource: 'recipient:bob',
      fingerprint: 'untrusted',
      ...change,
    } as ActionProposal;

    expect(() => normalizeActionPayload(proposal)).toThrow(message);
  });
});

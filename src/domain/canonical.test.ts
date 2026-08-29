import { describe, expect, it } from 'vitest';

import { canonicalize, checksum } from './canonical';

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
});

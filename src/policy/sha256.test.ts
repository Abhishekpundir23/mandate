import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { sha256 } from './sha256';
import { utf8Bytes, utf8Length } from './utf8';

describe('portable SHA-256', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['hello', '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
  ])('matches the independent known vector %j', (text, expected) => {
    expect(sha256(text)).toBe(expected);
  });

  test.each([1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 262144])(
    'agrees with Node crypto at a %i-byte padding boundary',
    (length) => {
      const text = 'x'.repeat(length);
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    },
  );

  test.each(['é', 'हिंदी', '😀', 'a\u0000b', '\u007f\u0080\u07ff\u0800\uffff', 'é😀'.repeat(100)])(
    'hashes valid UTF-8 without platform APIs: %j',
    (text) => {
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    },
  );

  test('preserves spelling instead of normalizing Unicode', () => {
    expect(sha256('é')).not.toBe(sha256('e\u0301'));
  });
});

describe('strict portable UTF-8', () => {
  test.each([
    ['', [], 0],
    ['A', [65], 1],
    ['é', [195, 169], 2],
    ['ह', [224, 164, 185], 3],
    ['😀', [240, 159, 152, 128], 4],
    ['Aéह😀', [65, 195, 169, 224, 164, 185, 240, 159, 152, 128], 10],
  ] as const)('encodes %j as exact bytes', (text, bytes, length) => {
    expect(utf8Bytes(text)).toEqual(bytes);
    expect(utf8Length(text)).toBe(length);
  });

  test.each(['\ud800', '\udfff', 'a\ud800z', '\udc00\ud800', '\ud800\ud800'])(
    'rejects unpaired surrogate %j rather than hashing a replacement',
    (text) => {
      expect(() => utf8Bytes(text)).toThrow('Invalid Unicode');
      expect(() => utf8Length(text)).toThrow('Invalid Unicode');
      expect(() => sha256(text)).toThrow('Invalid Unicode');
    },
  );
});

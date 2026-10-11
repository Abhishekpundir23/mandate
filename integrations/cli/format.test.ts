import { expect, test } from 'vitest';
import { formatCliOutput } from './format';

test('JSON output preserves data and escapes control characters', () => {
  const value = { statement: 'line\nnext\u0000', values: [1, false, null] };
  const text = formatCliOutput(value, 'json');
  expect(JSON.parse(text)).toEqual(value);
  expect(text).not.toContain('\u0000');
});

test('text output neutralizes terminal escapes and bidirectional formatting controls', () => {
  const text = formatCliOutput({ '\u001b[31mkey': 'value\u202e\nnext' }, 'text');
  expect(text).not.toContain('\u001b');
  expect(text).not.toContain('\u202e');
  expect(text).toContain('\\u001b[31mkey');
  expect(text).toContain('value\\u202e\\u000anext');
});

test('renders nested report values without collapsing booleans and empty collections', () => {
  const text = formatCliOutput({ allowed: false, records: [], nested: { count: 2 } }, 'text');
  expect(text).toContain('allowed: false');
  expect(text).toContain('(none)');
  expect(text).toContain('count: 2');
});

test('bounds emitted output before passing it to stdout', () => {
  expect(() => formatCliOutput({ value: 'x'.repeat(8 * 1024 * 1024) }, 'json')).toThrow('OUTPUT_LIMIT');
});

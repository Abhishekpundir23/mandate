import { describe, expect, test } from 'vitest';
import { applyDataEdits } from './edits';
describe('bounded explicit data edits', () => {
  test('applies ordered own-property edits without changing the input', () => {
    const source = { nested: { value: true }, list: ['a', 'b'], keep: null };
    const before = JSON.stringify(source);
    const result = applyDataEdits(source, [
      { operation: 'SET', path: ['nested', 'value'], value: false },
      { operation: 'SET', path: ['new'], value: { exact: true } },
      { operation: 'DELETE', path: ['list', 0] },
    ]);
    expect(result).toEqual({ nested: { value: false }, list: ['b'], keep: null, new: { exact: true } });
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
  });
  test.each([
    { operation: 'SET', path: ['__proto__', 'polluted'], value: true },
    { operation: 'SET', path: ['constructor'], value: true },
    { operation: 'DELETE', path: ['prototype'] },
    { operation: 'SET', path: [], value: true },
    { operation: 'SET', path: ['missing', 'child'], value: true },
    { operation: 'DELETE', path: ['missing'] },
    { operation: 'SET', path: ['list', -1], value: true },
    { operation: 'SET', path: ['list', 9], value: true },
    { operation: 'SET', path: ['list', '0'], value: true },
    { operation: 'SET', path: ['nested', 0], value: true },
    { operation: 'SET', path: ['new'] },
    { operation: 'DELETE', path: ['nested'], value: true },
    { operation: 'EVALUATE', path: ['nested'], value: 'code' },
  ])('rejects ambiguous, missing or dangerous mutation target %#', (edit) => {
    expect(() => applyDataEdits({ nested: true, list: ['a'] }, [edit] as never)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  test('limits changes and path depth before applying anything', () => {
    expect(() => applyDataEdits({}, Array.from({ length: 9 }, (_, i) => ({ operation: 'SET', path: ['k' + i], value: i })))).toThrow();
    expect(() => applyDataEdits({}, [{ operation: 'SET', path: Array.from({ length: 17 }, () => 'inner'), value: true }])).toThrow();
  });
  test('empty edits are a positive control and return independent owned data', () => {
    const source = { nested: { value: true } };
    const result = applyDataEdits(source, []);
    expect(result).toEqual(source); expect(result).not.toBe(source);
  });
});

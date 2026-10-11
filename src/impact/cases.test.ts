import { describe, expect, test } from 'vitest';
import { parseCaseSuite, validateCaseSuite, serializeCaseSuite } from './cases';
const action = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } };
const single = { schemaVersion: 1, id: 'suite', title: 'Case suite', cases: [{ id: 'read', label: 'Read', action }] };
describe('case suite ingestion', () => {
  test('accepts zero cases with no invented success rate', () => {
    expect(parseCaseSuite(JSON.stringify({ ...single, cases: [] })).cases).toEqual([]);
  });
  test('accepts exactly 100 independent cases and produces an importable export', () => {
    const suite = parseCaseSuite(JSON.stringify({ ...single, cases: Array.from({ length: 100 }, (_, i) => ({ id: 'case-' + i, label: 'Read ' + i, action })) }));
    expect(parseCaseSuite(serializeCaseSuite(suite))).toEqual(suite);
  });
  test.each([
    { ...single, schemaVersion: 2 },
    { ...single, id: '' },
    { ...single, id: '__bad id__' },
    { ...single, title: 'x'.repeat(257) },
    { ...single, executionPerformed: true },
    { ...single, cases: [single.cases[0], single.cases[0]] },
    { ...single, cases: Array.from({ length: 101 }, (_, i) => ({ ...single.cases[0], id: 'c' + i })) },
    { ...single, cases: [{ ...single.cases[0], expected: { after: 'YES' } }] },
    { ...single, cases: [{ ...single.cases[0], expected: { after: 'ALLOW', extra: true } }] },
    { ...single, cases: [{ ...single.cases[0], action: { operation: 'shell.exec', args: {} } }] },
    { ...single, cases: [{ ...single.cases[0], action: { ...action, args: { ...action.args, path: '../secret' } } }] },
    { ...single, cases: [{ ...single.cases[0], action: { ...action, effect: 'EXTERNAL_TRANSMIT' } }] },
    { ...single, cases: [{ ...single.cases[0], hidden: true }] },
  ])('rejects malformed or lossy suite %#', (value) => {
    expect(() => parseCaseSuite(JSON.stringify(value))).toThrow();
  });
  test('rejects byte and depth exhaustion before schema traversal', () => {
    expect(() => parseCaseSuite(' '.repeat(262145))).toThrow();
    expect(() => parseCaseSuite('['.repeat(33) + '0' + ']'.repeat(33))).toThrow();
  });
  test('rejects accessors without running them', () => {
    let count = 0;
    const value = { ...single };
    Object.defineProperty(value, 'cases', { enumerable: true, get() { count++; return single.cases; } });
    expect(() => validateCaseSuite(value)).toThrow();
    expect(count).toBe(0);
  });
  test('rejects explicit undefined, sparse and cyclic inputs', () => {
    expect(() => validateCaseSuite({ ...single, title: undefined })).toThrow();
    expect(() => validateCaseSuite({ ...single, cases: new Array(2) })).toThrow();
    const value: Record<string, unknown> = { ...single }; value.cycle = value;
    expect(() => validateCaseSuite(value)).toThrow();
  });
});

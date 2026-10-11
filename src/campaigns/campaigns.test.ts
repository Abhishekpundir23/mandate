import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../scenarios/catalog';
import { parseCampaign, serializeCampaign } from './schema';
import { runCampaign } from './run';
import { maintainedCampaign } from './catalog';
import {
  compareCampaignReports,
  queryCampaign,
  summarizeCampaign,
  redactCampaignReport,
} from './report';
const base = () => ({
  schemaVersion: 1,
  id: 'trace-attacks',
  title: 'Trace attacks',
  scenarios: [scenarioCatalog[0]],
  cases: [
    {
      id: 'control',
      title: 'No changes',
      category: 'control',
      kind: 'TRACE',
      scenarioId: scenarioCatalog[0]!.id,
      edits: [],
      reseal: true,
      expected: { verification: 'ACCEPT' },
    },
    {
      id: 'receipt',
      title: 'Forged success',
      category: 'receipt',
      kind: 'TRACE',
      scenarioId: scenarioCatalog[0]!.id,
      edits: [
        {
          operation: 'SET',
          path: ['comparison', 'mandate', 'receipt', 'exactMandateSuccess'],
          value: false,
        },
      ],
      reseal: true,
      expected: { verification: 'REJECT', code: 'REPLAY_MISMATCH' },
    },
  ],
});
describe('reproducible adversarial campaigns', () => {
  test('positive controls pass while resealed forged receipts are rejected', () => {
    const campaign = parseCampaign(JSON.stringify(base()));
    const report = runCampaign(campaign);
    expect(report).toMatchObject({
      mode: 'synthetic-adversarial',
      externalActionsPerformed: false,
      canonicalBenchmark: false,
    });
    expect(report.cases.map((item) => [item.id, item.status, item.passed])).toEqual([
      ['control', 'ACCEPTED', true],
      ['receipt', 'REJECTED', true],
    ]);
    expect(summarizeCampaign(report)).toMatchObject({ total: 2, passed: 2, failed: 0, errors: 0 });
    expect(Object.isFrozen(report.cases)).toBe(true);
  });
  test('a wrong literal invariant fails rather than being learned from the result', () => {
    const value = base();
    value.cases[1]!.expected = { verification: 'ACCEPT' };
    const report = runCampaign(parseCampaign(JSON.stringify(value)));
    expect(report.cases[1]!.passed).toBe(false);
    expect(summarizeCampaign(report).failed).toBe(1);
  });
  test('invalid mutation locations are errors and cannot qualify as successful rejections', () => {
    const value = base();
    value.cases[1]!.edits = [{ operation: 'SET', path: ['missing', 'nested'], value: false }];
    const report = runCampaign(parseCampaign(JSON.stringify(value)));
    expect(report.cases[1]).toMatchObject({ status: 'ERROR', passed: false });
  });
  test('canonical export and reruns reproduce every report digest', () => {
    const campaign = parseCampaign(JSON.stringify(base()));
    const before = JSON.stringify(campaign);
    const report = runCampaign(campaign);
    expect(runCampaign(parseCampaign(serializeCampaign(campaign)))).toEqual(report);
    expect(JSON.stringify(campaign)).toBe(before);
    expect(compareCampaignReports(report, report).changes).toEqual([]);
  });
  test('queries combine status/category/expectation and pagination', () => {
    const report = runCampaign(parseCampaign(JSON.stringify(base())));
    expect(queryCampaign(report, { status: 'REJECTED' }).items.map((row) => row.id)).toEqual([
      'receipt',
    ]);
    expect(queryCampaign(report, { category: 'control', passed: true }).total).toBe(1);
    expect(queryCampaign(report, { page: 2, pageSize: 1 }).items[0]!.id).toBe('receipt');
    expect(() => queryCampaign(report, { pageSize: 101 })).toThrow();
    expect(() => queryCampaign(report, { text: 'x'.repeat(257) })).toThrow();
  });
  test('redacted reports omit titles and IDs while retaining pass and rejection counts', () => {
    const redacted = redactCampaignReport(runCampaign(parseCampaign(JSON.stringify(base()))));
    expect(redacted).toMatchObject({
      kind: 'redacted-campaign-report',
      replayable: false,
      authenticated: false,
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain('Forged success');
    expect(text).not.toContain('trace-attacks');
    expect(redacted.summary.passed).toBe(2);
  });
  test('the maintained catalog passes every independently declared invariant', () => {
    const report = runCampaign(maintainedCampaign);
    expect(report.cases.length).toBeGreaterThanOrEqual(40);
    expect(
      report.cases
        .filter((item) => !item.passed)
        .map((item) => ({ id: item.id, actual: item.actual })),
    ).toEqual([]);
    expect(new Set(report.cases.map((item) => item.kind))).toEqual(
      new Set(['POLICY', 'SCENARIO', 'TRACE']),
    );
  });
});
describe('campaign input boundaries', () => {
  test.each([
    { ...base(), schemaVersion: 2 },
    { ...base(), id: 'bad id' },
    { ...base(), extra: true },
    { ...base(), cases: [base().cases[0], base().cases[0]] },
    { ...base(), scenarios: [] },
    {
      ...base(),
      cases: Array.from({ length: 101 }, (_, i) => ({ ...base().cases[0], id: 'case-' + i })),
    },
    { ...base(), cases: [{ ...base().cases[0], expected: { verification: 'MAYBE' } }] },
    { ...base(), cases: [{ ...base().cases[0], scenarioId: 'unknown' }] },
    { ...base(), cases: [{ ...base().cases[0], executionPerformed: true }] },
  ])('rejects invalid or lossy campaign %#', (value) => {
    expect(() => parseCampaign(JSON.stringify(value))).toThrow();
  });
  test('rejects excessive input before recursive validation', () => {
    expect(() => parseCampaign(' '.repeat(2 * 1024 * 1024 + 1))).toThrow();
    expect(() => parseCampaign('['.repeat(49) + '0' + ']'.repeat(49))).toThrow();
  });
});

test('deleting required trace data is a verification rejection even after requested resealing', () => {
  const value = base();
  value.cases[1]!.edits = [
    { operation: 'DELETE', path: ['comparison', 'mandate', 'receipt'] } as never,
  ];
  const report = runCampaign(parseCampaign(JSON.stringify(value)));
  expect(report.cases[1]).toMatchObject({
    status: 'REJECTED',
    passed: true,
    actual: { code: 'REPLAY_MISMATCH' },
  });
});

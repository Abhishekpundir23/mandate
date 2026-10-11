import { describe, expect, test } from 'vitest';
import { canonicalize, normalizeJsonValue, checksum } from '../domain/canonical';
import { sha256 } from '../policy/sha256';
import { scenarioCatalog } from '../scenarios/catalog';
import { createTraceBundle, serializeTraceBundle, verifyTraceBundle } from './bundle';
import type { TraceBundle } from './types';
const original = () => createTraceBundle(scenarioCatalog[0]!);
function mutable(): TraceBundle { return JSON.parse(JSON.stringify(original())); }
function reseal(bundle: TraceBundle) {
  const payload = { schemaVersion: bundle.schemaVersion, kind: bundle.kind, mode: bundle.mode,
    externalActionsPerformed: bundle.externalActionsPerformed, scenario: bundle.scenario, comparison: bundle.comparison };
  return { ...payload, bundleDigest: sha256(canonicalize(normalizeJsonValue(payload))) };
}
function resealTrace(bundle: TraceBundle) {
  const trace = bundle.comparison.mandate;
  Object.assign(trace, { traceChecksum: checksum(normalizeJsonValue({ scenarioId: trace.scenarioId, runner: trace.runner,
    scenarioChecksum: trace.scenarioChecksum, proposalChecksum: trace.proposalChecksum, events: trace.events,
    terminalWorld: trace.terminalWorld, receipt: trace.receipt })) });
  Object.assign(bundle.comparison, { traceChecksum: checksum({ standard: bundle.comparison.standard.traceChecksum, mandate: trace.traceChecksum }) });
  return reseal(bundle);
}
describe('paired trace bundle reconstruction', () => {
  test.each(scenarioCatalog.map((scenario) => ({ scenario })))('reconstructs $scenario.id without authenticating it', ({ scenario }) => {
    const bundle = createTraceBundle(scenario);
    const text = serializeTraceBundle(bundle);
    const verified = verifyTraceBundle(text);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('expected verified');
    expect(verified.authenticated).toBe(false);
    expect(verified.bundle).toEqual(bundle);
    expect(Object.isFrozen(verified.bundle.comparison.mandate.events)).toBe(true);
    expect(serializeTraceBundle(verified.bundle)).toBe(text);
  });
  test('a consistent new scenario is reproducible but never authenticated', () => {
    const scenario = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    scenario.title = 'A private reproduction';
    const bundle = createTraceBundle(scenario);
    expect(bundle.bundleDigest).not.toBe(original().bundleDigest);
    expect(verifyTraceBundle(serializeTraceBundle(bundle))).toMatchObject({ ok: true, authenticated: false });
  });
  test('altering the wrapper digest fails before a replay can qualify it', () => {
    const bundle = mutable();
    expect(verifyTraceBundle(JSON.stringify({ ...bundle, bundleDigest: '0'.repeat(64) }))).toMatchObject({ ok: false, code: 'DIGEST_MISMATCH' });
  });
  test.each([
    ['observation facts', (bundle: TraceBundle) => {
      const event = bundle.comparison.mandate.events.find((item) => item.observation)!;
      Object.assign(event.observation!.facts, { draftSaved: false });
    }],
    ['observation identity', (bundle: TraceBundle) => {
      const event = bundle.comparison.mandate.events.find((item) => item.observation)!;
      Object.assign(event.observation!, { evidenceId: 'forged-evidence' });
    }],
    ['claim verification', (bundle: TraceBundle) => {
      const event = bundle.comparison.mandate.events.find((item) => item.type === 'CLAIM_EVALUATED')!;
      Object.assign(event, { verified: false });
    }],
    ['claim support', (bundle: TraceBundle) => {
      const event = bundle.comparison.mandate.events.find((item) => item.type === 'CLAIM_EVALUATED')!;
      Object.assign(event, { evidenceIds: [] });
    }],
    ['world snapshot', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.events[0]!.world, { submitted: true }); }],
    ['terminal world', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.terminalWorld, { submitted: true }); }],
    ['receipt success', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.receipt, { exactMandateSuccess: false }); }],
    ['receipt authority', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.receipt, { authorityIntegrity: false }); }],
    ['receipt missing evidence', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.receipt, { evidenceIds: [] }); }],
    ['gate outcome', (bundle: TraceBundle) => {
      const event = bundle.comparison.mandate.events.find((item) => item.outcome === 'BLOCK')!;
      Object.assign(event, { outcome: 'ALLOW', decision: { ...event.decision, outcome: 'ALLOW' } });
    }],
    ['authority version', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.contractVersions[0]!, { hash: 'forged' }); }],
    ['missing event', (bundle: TraceBundle) => { (bundle.comparison.mandate.events as unknown[]).splice(2, 1); }],
    ['extra event field', (bundle: TraceBundle) => { Object.assign(bundle.comparison.mandate.events[0]!, { secret: 'do-not-echo' }); }],
    ['paired runner metadata', (bundle: TraceBundle) => { Object.assign(bundle.comparison.standard, { runner: 'mandate' }); }],
  ] as const)('rejects resealed %s', (_label, alter) => {
    const bundle = mutable(); alter(bundle);
    const result = verifyTraceBundle(JSON.stringify(resealTrace(bundle)));
    expect(result).toMatchObject({ ok: false, authenticated: false, code: 'REPLAY_MISMATCH' });
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
  });
  test.each([
    { schemaVersion: 2 }, { kind: 'real-execution' }, { executionPerformed: true }, { unexpected: true },
  ])('rejects strict wrapper changes %#', (change) => {
    expect(verifyTraceBundle(JSON.stringify({ ...mutable(), ...change }))).toMatchObject({ ok: false, code: 'INVALID_BUNDLE' });
  });
  test('unsupported scenario capabilities remain rejected even with a correct envelope hash', () => {
    const bundle = mutable();
    const action = bundle.scenario.proposalProgram.main.find((item) => item.kind === 'ACTION')!;
    if (action.kind === 'ACTION') Object.assign(action.action, { tool: 'shell', operation: 'execute' });
    expect(verifyTraceBundle(JSON.stringify(reseal(bundle)))).toMatchObject({ ok: false, code: 'INVALID_SCENARIO' });
  });
  test('byte, nesting, malformed Unicode and JSON failures return bounded redacted results', () => {
    for (const text of [' '.repeat(4 * 1024 * 1024 + 1), '['.repeat(49) + '0' + ']'.repeat(49), '{', '"\ud800"']) {
      const result = verifyTraceBundle(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result).length).toBeLessThan(200);
    }
  });
});

test('serialization rejects accessor fields without executing user code', () => {
  let calls = 0;
  const bundle = mutable();
  Object.defineProperty(bundle, 'scenario', { enumerable: true, get() { calls++; return original().scenario; } });
  expect(() => serializeTraceBundle(bundle)).toThrow();
  expect(calls).toBe(0);
});

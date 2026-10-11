import { z } from '../domain/zod';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import type { ScenarioDefinition } from '../domain/types';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { sha256 } from '../policy/sha256';
import { runComparison } from '../runtime/runner';
import { labLimits, parseLabScenario } from '../lab/parse';
import type { BundleVerification, TraceBundle } from './types';
export const traceBundleLimits = freezeData({ bytes: 4 * 1024 * 1024, depth: 48, nodes: 500000 });
const bundleSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('paired-trace-bundle'), mode: z.literal('deterministic-sandbox'),
  externalActionsPerformed: z.literal(false), scenario: z.unknown(), comparison: z.unknown(),
  bundleDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
function digest(value: unknown): string { return sha256(canonicalize(normalizeJsonValue(value))); }
export function createTraceBundle(input: ScenarioDefinition): TraceBundle {
  const scenario = parseLabScenario(JSON.stringify(normalizeBoundedJson(input, labLimits)));
  const comparison = runComparison(scenario);
  const payload = { schemaVersion: 1 as const, kind: 'paired-trace-bundle' as const,
    mode: 'deterministic-sandbox' as const, externalActionsPerformed: false as const, scenario, comparison };
  // Runtime outputs contain shared terminal/world references. Expand only these
  // trusted internal aliases into an owned JSON tree before exposing the bundle.
  return parseBoundedJson(JSON.stringify({ ...payload, bundleDigest: digest(payload) }), traceBundleLimits) as unknown as TraceBundle;
}
export function serializeTraceBundle(bundle: TraceBundle): string {
  return canonicalize(normalizeBoundedJson(bundle, traceBundleLimits));
}
export function verifyTraceBundle(text: string): BundleVerification {
  let value: unknown;
  try { value = parseBoundedJson(text, traceBundleLimits); }
  catch { return freezeData({ ok: false, authenticated: false, code: 'INVALID_INPUT' }); }
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) return freezeData({ ok: false, authenticated: false, code: 'INVALID_BUNDLE' });
  const data = parsed.data;
  const payload = { schemaVersion: data.schemaVersion, kind: data.kind, mode: data.mode,
    externalActionsPerformed: data.externalActionsPerformed, scenario: data.scenario, comparison: data.comparison };
  if (digest(payload) !== data.bundleDigest) return freezeData({ ok: false, authenticated: false, code: 'DIGEST_MISMATCH' });
  let scenario: ScenarioDefinition;
  try { scenario = parseLabScenario(JSON.stringify(data.scenario)); }
  catch { return freezeData({ ok: false, authenticated: false, code: 'INVALID_SCENARIO' }); }
  let reconstructed: TraceBundle;
  try { reconstructed = createTraceBundle(scenario); }
  catch { return freezeData({ ok: false, authenticated: false, code: 'INVALID_SCENARIO' }); }
  // Full equality rejects unknown nested fields as well as plausible resealed forgeries.
  if (canonicalize(normalizeJsonValue(reconstructed.comparison)) !== canonicalize(normalizeJsonValue(data.comparison))) {
    return freezeData({ ok: false, authenticated: false, code: 'REPLAY_MISMATCH' });
  }
  return freezeData({ ok: true, authenticated: false, bundle: reconstructed });
}

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { getPolicyTemplate } from '../policy/templates';
import { recordSession, serializeSession, appendSessionCheck } from './record';
import { verifySession } from './verify';
import type { Session } from './types';

const policyText = JSON.stringify(getPolicyTemplate('draft-only').policy);
const read = { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } };
const push = { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'a'.repeat(40) } };
const original = recordSession(policyText, [read, push], 'audit', 'Reproducible');
const clone = () => JSON.parse(serializeSession(original)) as Session;
const hash = (value: unknown) => createHash('sha256').update(canonicalize(normalizeJsonValue(value))).digest('hex');

/** Simulate an attacker who knows the public hash algorithm, not a trusted signer. */
function reseal(session: Session): Session {
  const rootHash = hash({ schemaVersion: 1, mode: 'advisory', executionPerformed: false, sessionId: session.sessionId, label: session.label, policy: session.policy, policyDigest: session.policyDigest });
  let previousHash = rootHash;
  const records = session.records.map((record, index) => {
    const payload = { sequence: index + 1, action: record.action, result: record.result, previousHash };
    const sealed = { ...payload, hash: hash(payload) };
    previousHash = sealed.hash;
    return sealed;
  });
  return { ...session, rootHash, records, recordCount: records.length, terminalHash: previousHash };
}

describe('session integrity and independent replay', () => {
  test('accepts a reproducible session without claiming authentication', () => {
    const result = verifySession(serializeSession(original));
    expect(result).toMatchObject({ ok: true, authenticated: false });
    if (result.ok) expect(result.session.records[1]?.result.decision.outcome).toBe('BLOCK');
  });

  test('ignores serialization whitespace and object-key order', () => {
    const input = JSON.parse(serializeSession(original));
    const rearranged = Object.fromEntries(Object.entries(input).reverse());
    expect(verifySession(JSON.stringify(rearranged, null, 2)).ok).toBe(true);
  });

  test.each([
    ['identity', (s: Session) => ({ ...s, sessionId: 'changed' })],
    ['label', (s: Session) => ({ ...s, label: 'changed' })],
    ['root', (s: Session) => ({ ...s, rootHash: '0'.repeat(64) })],
    ['terminal', (s: Session) => ({ ...s, terminalHash: '0'.repeat(64) })],
    ['count', (s: Session) => ({ ...s, recordCount: 1 })],
    ['omission', (s: Session) => ({ ...s, records: s.records.slice(1) })],
    ['reorder', (s: Session) => ({ ...s, records: [...s.records].reverse() })],
    ['duplicate', (s: Session) => ({ ...s, records: [s.records[0]!, s.records[0]!] })],
  ] as const)('rejects changed %s without resealing', (_label, change) => {
    expect(verifySession(JSON.stringify(change(clone()))).ok).toBe(false);
  });

  test('rejects a forged ALLOW even when every public hash is correctly recomputed', () => {
    const input = clone();
    const records = input.records.map((record, index) => index === 1 ? {
      ...record,
      result: { ...record.result, decision: { ...record.result.decision, outcome: 'ALLOW' as const, reasons: ['Matching active authority'] } },
    } : record);
    const forged = reseal({ ...input, records });
    const result = verifySession(JSON.stringify(forged));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((item) => item.code === 'REPLAY')).toBe(true);
  });

  test('binds the complete derived action metadata, not only its displayed outcome', () => {
    const input = clone();
    const first = input.records[0]!;
    const record = { ...first, result: { ...first.result, proposal: { ...first.result.proposal, resource: 'repository:other' } } };
    const result = verifySession(JSON.stringify(reseal({ ...input, records: [record, input.records[1]!] })));
    expect(result.ok).toBe(false);
  });

  test('rejects a stale record policy digest even after hashes are repaired', () => {
    const input = clone();
    const records = input.records.map((record) => ({ ...record, result: { ...record.result, policyDigest: 'f'.repeat(64) } }));
    expect(verifySession(JSON.stringify(reseal({ ...input, records }))).ok).toBe(false);
  });

  test('a wholly replaced internally valid session remains explicitly unauthenticated', () => {
    const replacement = recordSession(JSON.stringify(getPolicyTemplate('read-only').policy), [read], 'replacement', 'Operator supplied');
    expect(verifySession(serializeSession(replacement))).toMatchObject({ ok: true, authenticated: false });
  });

  test.each([
    { ...original, schemaVersion: 2 },
    { ...original, executionPerformed: true },
    { ...original, mode: 'enforcing' },
    { ...original, signature: 'pretend-authenticated' },
    { ...original, records: [{ ...original.records[0], extra: true }] },
  ])('rejects unsupported or extra fields %#', (value) => {
    expect(verifySession(JSON.stringify(value)).ok).toBe(false);
  });

  test('returns bounded errors without reflecting malicious content', () => {
    const result = verifySession('{"secret":"do-not-echo"}');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
    expect(JSON.stringify(result)).not.toContain('stack');
  });

  test('rejects input beyond one MiB before parsing', () => {
    const result = verifySession(' '.repeat(1024 * 1024 + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('SIZE');
  });

  test('cannot append to a forged imported session', () => {
    const input = clone();
    expect(() => appendSessionCheck({ ...input, terminalHash: '0'.repeat(64) }, read)).toThrow('Invalid session');
  });
});

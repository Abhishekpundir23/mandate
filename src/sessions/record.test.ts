import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../policy/templates';
import { createSession, appendSessionCheck, recordSession, serializeSession } from './record';
import { verifySession } from './verify';

const policyText = JSON.stringify(getPolicyTemplate('draft-only').policy);
const read = {
  operation: 'workspace.readFile' as const,
  args: { repositoryId: 'mandate', path: 'README.md' },
};
const push = {
  operation: 'git.push' as const,
  args: {
    repositoryId: 'mandate',
    remoteId: 'origin',
    ref: 'refs/heads/main',
    commitOid: 'a'.repeat(40),
  },
};

describe('immutable advisory session recording', () => {
  test('creates an empty session bound to policy content', () => {
    const session = createSession(policyText, 'session-1', 'Local review');
    expect(session).toMatchObject({
      schemaVersion: 1,
      mode: 'advisory',
      executionPerformed: false,
      sessionId: 'session-1',
      label: 'Local review',
      recordCount: 0,
    });
    expect(session.records).toEqual([]);
    expect(session.terminalHash).toBe(session.rootHash);
    expect(session.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySession(serializeSession(session))).toMatchObject({
      ok: true,
      authenticated: false,
    });
  });

  test('records decisions in order without changing earlier session objects', () => {
    const empty = createSession(policyText, 'session-1', 'Local review');
    const first = appendSessionCheck(empty, read);
    const second = appendSessionCheck(first, push);
    expect(empty.records).toHaveLength(0);
    expect(first.records).toHaveLength(1);
    expect(second.records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(second.records.map((record) => record.result.decision.outcome)).toEqual([
      'ALLOW',
      'BLOCK',
    ]);
    expect(second.records[0]?.previousHash).toBe(empty.rootHash);
    expect(second.records[1]?.previousHash).toBe(first.terminalHash);
    expect(second.terminalHash).toBe(second.records[1]?.hash);
    expect(second.recordCount).toBe(2);
  });

  test('freezes nested action and policy data', () => {
    const session = appendSessionCheck(createSession(policyText, 'freeze', ''), read);
    expect(Object.isFrozen(session.records[0]?.action.args)).toBe(true);
    expect(Object.isFrozen(session.policy.diffs)).toBe(true);
    expect(Object.isFrozen(session.records[0]?.result.decision)).toBe(true);
  });

  test('bulk recording gives the same deterministic session as ordered append', () => {
    const incremental = appendSessionCheck(
      appendSessionCheck(createSession(policyText, 'bulk', 'Same input'), read),
      push,
    );
    const bulk = recordSession(policyText, [read, push], 'bulk', 'Same input');
    expect(serializeSession(bulk)).toBe(serializeSession(incremental));
    expect(bulk.records.map((record) => record.result.executionPerformed)).toEqual([false, false]);
  });

  test('binds identity and label into the root even before a check', () => {
    const first = createSession(policyText, 'first', 'one');
    expect(createSession(policyText, 'second', 'one').rootHash).not.toBe(first.rootHash);
    expect(createSession(policyText, 'first', 'two').rootHash).not.toBe(first.rootHash);
  });

  test('uses the policy at session creation instead of later editor changes', () => {
    const before = appendSessionCheck(createSession(policyText, 'before', ''), read);
    const restricted = JSON.stringify(getPolicyTemplate('read-only').policy);
    const after = createSession(restricted, 'after', '');
    expect(after.policyDigest).not.toBe(before.policyDigest);
    expect(before.records[0]?.result.policyDigest).toBe(before.policyDigest);
  });

  test.each(['', 'has spaces', 'slash/id', 'x'.repeat(65)])(
    'rejects invalid session ID %j',
    (id) => {
      expect(() => createSession(policyText, id, '')).toThrow();
    },
  );

  test('rejects oversized labels and action lists before recording', () => {
    expect(() => createSession(policyText, 'valid', 'x'.repeat(257))).toThrow();
    expect(() =>
      recordSession(
        policyText,
        Array.from({ length: 501 }, () => read),
        'valid',
        '',
      ),
    ).toThrow();
  });

  test('supports 500 small real checks and rejects the next append', () => {
    const session = recordSession(
      policyText,
      Array.from({ length: 500 }, () => read),
      'maximum',
      '',
    );
    expect(session.recordCount).toBe(500);
    expect(verifySession(serializeSession(session)).ok).toBe(true);
    expect(() => appendSessionCheck(session, read)).toThrow();
  }, 30000);

  test('rejects caller-controlled confirmation while recording', () => {
    expect(() =>
      appendSessionCheck(createSession(policyText, 'invalid', ''), { ...read, confirmation: true }),
    ).toThrow();
  });

  test('records CONFIRM as a pending decision rather than manufacturing approval', () => {
    const policy = JSON.stringify(getPolicyTemplate('review-required').policy);
    const commit = {
      operation: 'git.commit',
      args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) },
    };
    const session = recordSession(policy, [commit], 'confirm', '');
    expect(session.records[0]?.result.decision.outcome).toBe('CONFIRM');
    expect(session.records[0]?.result.executionPerformed).toBe(false);
  });
});

test('serialized bundles remain importable near the byte boundary', () => {
  const wideRead = {
    operation: 'workspace.readFile',
    args: { repositoryId: 'mandate', path: 'x'.repeat(384) },
  };
  const session = recordSession(
    policyText,
    Array.from({ length: 500 }, () => wideRead),
    'wide',
    '',
  );
  expect(verifySession(serializeSession(session)).ok).toBe(true);
}, 30000);

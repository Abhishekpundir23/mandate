import { expect, test } from 'vitest';
import { deriveAction, validateCodingCapability } from './actions';
import { parsePolicyJson } from './policy';
import { makePolicy } from './test-policy';

const snapshot = parsePolicyJson(JSON.stringify(makePolicy()));
const commit = { operation: 'git.commit' as const, args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };

test('derives exact effect, resource, and canonical proposal', () => {
  const action = deriveAction(snapshot, commit);
  expect(action).toMatchObject({ tool: 'git', operation: 'commit', effect: 'LOCAL_PERSIST', resource: 'repository:mandate', args: commit.args });
  expect(deriveAction(snapshot, { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'src/app/App.tsx' } })).toMatchObject({ effect: 'READ', resource: 'repository:mandate/file:src/app/App.tsx' });
  expect(deriveAction(snapshot, { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/feature', commitOid: 'a'.repeat(40) } })).toMatchObject({ effect: 'EXTERNAL_TRANSMIT', resource: 'repository:mandate/remote:origin/ref:refs/heads/feature' });
  expect(validateCodingCapability(snapshot)(action)).toEqual({ ok: true, effects: ['LOCAL_PERSIST'], resource: 'repository:mandate' });
  expect(validateCodingCapability(snapshot)({ ...action, effect: 'READ' })).toMatchObject({ ok: false });
  expect(validateCodingCapability(snapshot)({ ...action, resource: 'repository:other' })).toMatchObject({ ok: false });
});

test.each(['../secret', '/etc/passwd', 'x//y', './x', 'x/..', 'x\\y', 'e\u0301.txt', 'x\u0000', 'x'.repeat(1025)])('rejects unsafe path %j', (path) => {
  expect(() => deriveAction(snapshot, { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path } })).toThrow();
});

test.each(['refs/heads/', 'refs/heads/.hidden', 'refs/heads/x.lock', 'refs/heads/a..b', 'refs/heads/x y', 'refs/heads/x\\y', 'refs/heads/x@{y', 'refs/tags/v1'])('rejects unsupported ref %j', (ref) => {
  expect(() => deriveAction(snapshot, { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref, commitOid: 'a'.repeat(40) } })).toThrow();
});

test.each([
  { ...commit, effect: 'READ' }, { ...commit, resource: 'other' }, { ...commit, fingerprint: 'x' }, { ...commit, confirmation: {} },
  { operation: 'shell', args: {} }, { ...commit, args: { ...commit.args, repositoryId: 'constructor' } },
  { ...commit, args: { ...commit.args, treeDigest: 'A'.repeat(64) } },
  { ...commit, args: { ...commit.args, messageDigest: 'a'.repeat(63) } },
  { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'elsewhere', ref: 'refs/heads/x', commitOid: 'a'.repeat(40) } },
  { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/x', commitOid: 'a'.repeat(41) } },
])('rejects forged or unknown action %#', (action) => { expect(() => deriveAction(snapshot, action as typeof commit)).toThrow(); });

test('accepts only explicitly configured prototype-like IDs and bounded actions', () => {
  const configured = parsePolicyJson(JSON.stringify(makePolicy({ repositories: [{ id: 'constructor', remotes: [] }], diffs: [] })));
  expect(deriveAction(configured, { ...commit, args: { ...commit.args, repositoryId: 'constructor' } }).resource).toBe('repository:constructor');
  expect(() => deriveAction(snapshot, { ...commit, args: { ...commit.args, treeDigest: 'a'.repeat(16_385) } })).toThrow();
});

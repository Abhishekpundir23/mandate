import { expect, test } from 'vitest';
import { policyTemplates, getPolicyTemplate } from './templates';
import { parsePolicyJson } from './parse';
import { checkAction } from './service';

const commit = {
  operation: 'git.commit',
  args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) },
};
const push = {
  operation: 'git.push',
  args: {
    repositoryId: 'mandate',
    remoteId: 'origin',
    ref: 'refs/heads/main',
    commitOid: 'a'.repeat(40),
  },
};

test.each([
  ['draft-only', commit, 'ALLOW'],
  ['draft-only', push, 'BLOCK'],
  ['review-required', commit, 'CONFIRM'],
  ['read-only', commit, 'BLOCK'],
  [
    'read-only',
    { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } },
    'ALLOW',
  ],
])('template %s gives declared outcome %#', (id, action, expected) => {
  const snapshot = parsePolicyJson(JSON.stringify(getPolicyTemplate(id).policy));
  expect(
    checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action }).decision.outcome,
  ).toBe(expected);
});

test('template catalog is immutable and does not silently default unknown IDs', () => {
  expect(Object.isFrozen(policyTemplates)).toBe(true);
  expect(Object.isFrozen(policyTemplates[0]?.policy.diffs)).toBe(true);
  expect(() => getPolicyTemplate('missing')).toThrow('Unknown policy template');
});

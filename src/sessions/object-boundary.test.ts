import { expect, test } from 'vitest';
import { getPolicyTemplate } from '../policy/templates';
import { appendSessionCheck, createSession, recordSession, serializeSession } from './record';
const policy = JSON.stringify(getPolicyTemplate('draft-only').policy);
const action = {
  operation: 'workspace.readFile',
  args: { repositoryId: 'mandate', path: 'README.md' },
};
test.each(['serialize', 'append'] as const)(
  '%s rejects accessor sessions without invoking them',
  (operation) => {
    let calls = 0;
    const session = { ...createSession(policy, 'session') };
    Object.defineProperty(session, 'records', {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    expect(() =>
      operation === 'serialize' ? serializeSession(session) : appendSessionCheck(session, action),
    ).toThrow();
    expect(calls).toBe(0);
  },
);
test('batch recording rejects accessor action entries before iteration', () => {
  let calls = 0;
  const actions = [action];
  Object.defineProperty(actions, '0', {
    enumerable: true,
    get() {
      calls++;
      return action;
    },
  });
  expect(() => recordSession(policy, actions, 'session')).toThrow();
  expect(calls).toBe(0);
});

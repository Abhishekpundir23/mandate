import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../policy/templates';
import { applyPolicy, checkWorkbenchAction, createWorkbenchState, editActionField, editPolicy, loadTemplateDraft, resetPolicyDraft } from './workbench-model';

describe('workbench state transitions', () => {
  test('starts with a valid applied policy and an empty advisory session', () => {
    const state = createWorkbenchState();
    expect(state.snapshot.policyId).toBe('draft-only');
    expect(state.session.recordCount).toBe(0);
    expect(state.result).toBeNull();
    expect(state.draftText).toBe(state.appliedText);
  });
  test('records the actual declared action decision', () => {
    const state = checkWorkbenchAction(createWorkbenchState());
    expect(state.result?.decision.outcome).toBe('ALLOW');
    expect(state.result?.executionPerformed).toBe(false);
    expect(state.session.recordCount).toBe(1);
    expect(state.session.records[0]?.result).toEqual(state.result);
  });
  test('editing any action field invalidates the displayed result immediately', () => {
    const checked = checkWorkbenchAction(createWorkbenchState());
    for (const field of ['path', 'repositoryId', 'treeDigest', 'messageDigest', 'remoteId', 'ref', 'commitOid'] as const) {
      const next = editActionField(checked, field, 'changed');
      expect(next.result).toBeNull();
      expect(next.session.recordCount).toBe(1);
    }
  });
  test('changing operation invalidates the result and computes a fresh BLOCK', () => {
    const next = checkWorkbenchAction(editActionField(checkWorkbenchAction(createWorkbenchState()), 'operation', 'git.push'));
    expect(next.result?.decision.outcome).toBe('BLOCK');
    expect(next.session.recordCount).toBe(2);
  });
  test('editing policy removes a prior ALLOW before validation', () => {
    const next = editPolicy(checkWorkbenchAction(createWorkbenchState()), '{');
    expect(next.result).toBeNull();
    expect(next.snapshot.policyId).toBe('draft-only');
  });
  test('invalid Apply preserves the last valid authority and existing records', () => {
    const checked = checkWorkbenchAction(createWorkbenchState());
    const next = applyPolicy(editPolicy(checked, '{'));
    expect(next.snapshot).toBe(checked.snapshot);
    expect(next.session).toBe(checked.session);
    expect(next.diagnostics[0]?.code).toBe('INVALID_JSON');
    expect(next.result).toBeNull();
  });
  test('a dirty policy cannot produce a decision presented as current', () => {
    const next = checkWorkbenchAction(editPolicy(createWorkbenchState(), '{}'));
    expect(next.result).toBeNull();
    expect(next.actionError).toContain('Apply');
    expect(next.session.recordCount).toBe(0);
  });
  test('applying changed policy starts a distinct session with the new digest', () => {
    const checked = checkWorkbenchAction(createWorkbenchState());
    const text = JSON.stringify(getPolicyTemplate('read-only').policy);
    const next = applyPolicy(editPolicy(checked, text));
    expect(next.snapshot.policyId).toBe('read-only');
    expect(next.session.recordCount).toBe(0);
    expect(next.session.policyDigest).toBe(next.snapshot.policyDigest);
    expect(next.session.policyDigest).not.toBe(checked.session.policyDigest);
  });
  test('reapplying equivalent JSON keeps recorded checks', () => {
    const checked = checkWorkbenchAction(createWorkbenchState());
    const next = applyPolicy(editPolicy(checked, JSON.stringify(checked.snapshot.document)));
    expect(next.session).toBe(checked.session);
    expect(next.session.recordCount).toBe(1);
  });
  test('template selection is a draft until explicitly applied', () => {
    const next = loadTemplateDraft(createWorkbenchState(), 'review-required');
    expect(next.snapshot.policyId).toBe('draft-only');
    expect(JSON.parse(next.draftText).policyId).toBe('review-required');
    expect(applyPolicy(next).snapshot.policyId).toBe('review-required');
  });
  test('reset restores the applied text without resetting history', () => {
    const checked = checkWorkbenchAction(createWorkbenchState());
    const next = resetPolicyDraft(editPolicy(checked, 'bad'));
    expect(next.draftText).toBe(checked.appliedText);
    expect(next.session).toBe(checked.session);
    expect(next.diagnostics).toEqual([]);
  });
  test('a confirmation policy reports CONFIRM without satisfying it', () => {
    const state = editActionField(createWorkbenchState('review-required'), 'operation', 'git.commit');
    const next = checkWorkbenchAction(state);
    expect(next.result?.decision.outcome).toBe('CONFIRM');
    expect(next.result?.executionPerformed).toBe(false);
  });
  test('malformed action fields produce no record and a visible validation error', () => {
    const state = editActionField(createWorkbenchState(), 'path', '../private');
    const next = checkWorkbenchAction(state);
    expect(next.result).toBeNull();
    expect(next.actionError).toContain('valid');
    expect(next.session.recordCount).toBe(0);
  });
  test('unknown repositories cannot inherit another repository authority', () => {
    const next = checkWorkbenchAction(editActionField(createWorkbenchState(), 'repositoryId', 'unknown'));
    expect(next.result).toBeNull();
    expect(next.session.recordCount).toBe(0);
  });
  test('checks the latest applied authority regardless of inspected historical versions', () => {
    const value = JSON.parse(JSON.stringify(getPolicyTemplate('draft-only').policy));
    value.diffs.push({ baseVersion: 2, turnId: 'withdraw', source: { turnId: 'withdraw', quote: 'Stop reading.' }, ops: [
      { op: 'REVOKE', tombstone: { id: 'stop', kind: 'REVOKED', statement: 'Stop reading', targetClauseIds: ['read'],
        revokedSelector: { tool: 'workspace', operation: 'readFile' }, source: { turnId: 'withdraw', quote: 'Stop reading.' } } },
    ] });
    const next = checkWorkbenchAction(applyPolicy(editPolicy(createWorkbenchState(), JSON.stringify(value))));
    expect(next.result?.contractVersion).toBe(3);
    expect(next.result?.decision.outcome).toBe('BLOCK');
  });
  test('leaves previous immutable states intact', () => {
    const original = createWorkbenchState();
    const checked = checkWorkbenchAction(original);
    expect(original.session.recordCount).toBe(0);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(Object.isFrozen(checked.action)).toBe(true);
  });
});

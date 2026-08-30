import { describe, expect, it } from 'vitest';

import type { ActionProposal, Clause, ContractVersion } from '../domain/types';
import {
  consumeConfirmation,
  emptyConfirmationStore,
  issueConfirmation,
} from './confirmation';
import { evaluateAction } from './gate';

const source = { turnId: 'turn-2', quote: 'Ask me before sending it.' } as const;

const sendToBob: ActionProposal = {
  id: 'send-message',
  stepId: 'step-4',
  tool: 'email',
  operation: 'send',
  args: { recipient: 'bob@example.test', body: 'Hello' },
  effect: 'EXTERNAL_TRANSMIT',
  resource: 'recipient:bob',
  fingerprint: 'untrusted-fixture-value',
};

const sendToAlice: ActionProposal = {
  ...sendToBob,
  args: { ...sendToBob.args, recipient: 'alice@example.test' },
};

function version(versionNumber: number, clauses: readonly Clause[] = []): ContractVersion {
  return {
    version: versionNumber,
    parentVersion: versionNumber === 1 ? null : versionNumber - 1,
    turnId: `turn-${versionNumber}`,
    source,
    clauses,
    hash: `version-${versionNumber}`,
  };
}

const confirmationClause: Clause = {
  id: 'confirm-send',
  kind: 'NEEDS_CONFIRMATION',
  statement: 'Confirm before sending to Bob.',
  selector: {
    tool: 'email',
    operation: 'send',
    resource: 'recipient:bob',
    effect: 'EXTERNAL_TRANSMIT',
  },
  introducedIn: 2,
  source,
  afterConfirmation: 'MAY',
};

describe('scoped single-use confirmations', () => {
  it('invalidates confirmation after the contract changes', () => {
    const v2 = version(2, [confirmationClause]);
    const v3 = version(3, [confirmationClause]);
    const token = issueConfirmation(v2, sendToBob);

    expect(consumeConfirmation(emptyConfirmationStore, token, v3, sendToBob).ok).toBe(false);
  });

  it('rejects replay and argument mutation', () => {
    const v2 = version(2, [confirmationClause]);
    const token = issueConfirmation(v2, sendToBob);

    expect(consumeConfirmation(emptyConfirmationStore, token, v2, sendToAlice).ok).toBe(false);
    const first = consumeConfirmation(emptyConfirmationStore, token, v2, sendToBob);
    expect(first.ok).toBe(true);
    expect(consumeConfirmation(first.store, token, v2, sendToBob).ok).toBe(false);
  });

  it('rejects replay through a cloned token with an altered id', () => {
    const v2 = version(2, [confirmationClause]);
    const token = issueConfirmation(v2, sendToBob);
    const first = consumeConfirmation(emptyConfirmationStore, token, v2, sendToBob);
    const alteredId = { ...token, id: `${token.id}-copy` };

    expect(first.ok).toBe(true);
    expect(consumeConfirmation(first.store, alteredId, v2, sendToBob).ok).toBe(false);
    expect(evaluateAction(v2, sendToBob, alteredId).outcome).toBe('CONFIRM');
  });

  it('issues only the immutable scoped token fields', () => {
    const token = issueConfirmation(version(2, [confirmationClause]), sendToBob);

    expect(Object.keys(token).sort()).toEqual([
      'actionFingerprint',
      'contractVersion',
      'id',
      'issuedAtLogicalStep',
    ]);
    expect(token.contractVersion).toBe(2);
    expect(token.issuedAtLogicalStep).toBe('step-4');
    expect(Object.isFrozen(token)).toBe(true);
  });

  it('returns a new frozen store without mutating the token or prior store', () => {
    const v2 = version(2, [confirmationClause]);
    const token = issueConfirmation(v2, sendToBob);
    const tokenSnapshot = structuredClone(token);
    const priorIds = emptyConfirmationStore.consumedTokenIds;

    const consumed = consumeConfirmation(emptyConfirmationStore, token, v2, sendToBob);

    expect(consumed.ok).toBe(true);
    expect(consumed.store).not.toBe(emptyConfirmationStore);
    expect(emptyConfirmationStore.consumedTokenIds).toBe(priorIds);
    expect(emptyConfirmationStore.consumedTokenIds).toEqual([]);
    expect(consumed.store.consumedTokenIds).toEqual([token.id]);
    expect(token).toEqual(tokenSnapshot);
    expect(Object.isFrozen(consumed.store)).toBe(true);
    expect(Object.isFrozen(consumed.store.consumedTokenIds)).toBe(true);
  });

  it('allows a matching conditional grant only with its action-bound token', () => {
    const v2 = version(2, [confirmationClause]);
    const token = issueConfirmation(v2, sendToBob);
    const sameActionAtAnotherStep = { ...sendToBob, stepId: 'step-5' };

    expect(evaluateAction(v2, sendToBob).outcome).toBe('CONFIRM');
    expect(evaluateAction(v2, sendToBob, token).outcome).toBe('ALLOW');
    expect(evaluateAction(v2, sendToAlice, token).outcome).toBe('CONFIRM');
    expect(evaluateAction(v2, sameActionAtAnotherStep, token).outcome).toBe('CONFIRM');
  });

  it.each(['MUST_NOT', 'REVOKED'] as const)(
    'does not let confirmation override an active %s denial',
    (kind) => {
      const v2 = version(2, [confirmationClause]);
      const token = issueConfirmation(v2, sendToBob);
      const denial: Clause = kind === 'MUST_NOT'
        ? {
            id: 'deny-send',
            kind: 'MUST_NOT',
            statement: 'Do not send to Bob.',
            selector: confirmationClause.selector!,
            introducedIn: 2,
            source,
          }
        : {
            id: 'revoke-send',
            kind: 'REVOKED',
            statement: 'Sending authority was revoked.',
            introducedIn: 2,
            source,
            revokedSelector: confirmationClause.selector!,
          };
      const deniedVersion = version(2, [confirmationClause, denial]);

      expect(evaluateAction(deniedVersion, sendToBob, token).outcome).toBe('BLOCK');
    },
  );
});

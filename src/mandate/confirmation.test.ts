import { describe, expect, it } from 'vitest';

import type {
  ActionProposal,
  CapabilityValidationPort,
  Clause,
  ConfirmationStore,
  ConfirmationToken,
  ContractVersion,
  JsonValue,
} from '../domain/types';
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
  resource: 'recipient:alice',
};

const validateEmailCapability: CapabilityValidationPort = (proposal) => {
  if (proposal.tool !== 'email') {
    return { ok: false, reason: 'Unknown tool' };
  }
  if (proposal.operation !== 'send') {
    return { ok: false, reason: 'Unknown operation' };
  }
  const recipient = proposal.args.recipient as JsonValue | undefined;
  if (typeof recipient !== 'string' || recipient.length === 0) {
    return { ok: false, reason: 'Invalid capability arguments' };
  }
  return {
    ok: true,
    effects: ['EXTERNAL_TRANSMIT'],
    resource: `recipient:${recipient.split('@')[0]}`,
  };
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

function gate(
  contract: ContractVersion,
  proposal: ActionProposal,
  confirmationStore: ConfirmationStore,
  confirmation?: ConfirmationToken,
) {
  return evaluateAction({
    version: contract,
    proposal,
    validateCapability: validateEmailCapability,
    confirmationStore,
    ...(confirmation === undefined ? {} : { confirmation }),
  });
}

describe('scoped single-use confirmations', () => {
  it('invalidates confirmation after the contract changes', () => {
    const v2 = version(2, [confirmationClause]);
    const v3 = version(3, [confirmationClause]);
    const issued = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 4);

    expect(consumeConfirmation(issued.store, issued.token, v3, sendToBob).ok).toBe(false);
  });

  it('rejects replay and argument mutation', () => {
    const v2 = version(2, [confirmationClause]);
    const issued = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 4);

    expect(consumeConfirmation(issued.store, issued.token, v2, sendToAlice).ok).toBe(false);
    const first = consumeConfirmation(issued.store, issued.token, v2, sendToBob);
    expect(first.ok).toBe(true);
    expect(consumeConfirmation(first.store, issued.token, v2, sendToBob).ok).toBe(false);
  });

  it('rejects a checksum-consistent token that is absent from the issued registry', () => {
    const v2 = version(2, [confirmationClause]);
    const issued = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 4);

    const result = gate(v2, sendToBob, emptyConfirmationStore, issued.token);

    expect(result.decision.outcome).toBe('CONFIRM');
    expect(result.confirmationStore).toBe(emptyConfirmationStore);
  });

  it('issues only immutable scoped token fields and registers the token in a new store', () => {
    const issued = issueConfirmation(
      emptyConfirmationStore,
      version(2, [confirmationClause]),
      sendToBob,
      4,
    );

    expect(Object.keys(issued.token).sort()).toEqual([
      'actionFingerprint',
      'contractVersion',
      'id',
      'issuedAtLogicalStep',
    ]);
    expect(issued.token.contractVersion).toBe(2);
    expect(issued.token.issuedAtLogicalStep).toBe(4);
    expect(issued.store).not.toBe(emptyConfirmationStore);
    expect(issued.store.issuedTokens).toEqual([issued.token]);
    expect(emptyConfirmationStore.issuedTokens).toEqual([]);
    expect(Object.isFrozen(issued.token)).toBe(true);
    expect(Object.isFrozen(issued.store)).toBe(true);
    expect(Object.isFrozen(issued.store.issuedTokens)).toBe(true);
  });

  it('atomically consumes a registered token at the gate boundary', () => {
    const v2 = version(2, [confirmationClause]);
    const issued = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 4);

    const first = gate(v2, sendToBob, issued.store, issued.token);
    const replay = gate(v2, sendToBob, first.confirmationStore, issued.token);

    expect(first.decision.outcome).toBe('ALLOW');
    expect(first.confirmationStore).not.toBe(issued.store);
    expect(first.confirmationStore.consumedTokenIds).toEqual([issued.token.id]);
    expect(issued.store.consumedTokenIds).toEqual([]);
    expect(replay.decision.outcome).toBe('CONFIRM');
    expect(replay.confirmationStore).toBe(first.confirmationStore);
  });

  it.each(['MUST_NOT', 'REVOKED'] as const)(
    'does not let confirmation override an active %s denial',
    (kind) => {
      const v2 = version(2, [confirmationClause]);
      const issued = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 4);
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

      const result = gate(deniedVersion, sendToBob, issued.store, issued.token);

      expect(result.decision.outcome).toBe('BLOCK');
      expect(result.confirmationStore).toBe(issued.store);
      expect(result.confirmationStore.consumedTokenIds).toEqual([]);
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid confirmation issuance step %s',
    (logicalStep) => {
      expect(() => issueConfirmation(emptyConfirmationStore, version(2), sendToBob, logicalStep))
        .toThrow(/non-negative safe integer/i);
    },
  );

  it('rejects malformed proposal input without changing the confirmation store', () => {
    const malformed = { ...sendToBob, args: { body: Symbol('unsafe') } };
    const issued = issueConfirmation(emptyConfirmationStore, version(2), sendToBob, 4);

    const result = consumeConfirmation(issued.store, issued.token, version(2), malformed);

    expect(result).toEqual({ ok: false, store: issued.store });
  });

  it('deduplicates identical issued tokens and keeps deterministic immutable ordering', () => {
    const v2 = version(2);
    const first = issueConfirmation(emptyConfirmationStore, v2, sendToBob, 5);
    const earlier = issueConfirmation(first.store, v2, sendToBob, 3);
    const duplicate = issueConfirmation(earlier.store, v2, sendToBob, 5);

    expect(duplicate.store.issuedTokens).toHaveLength(2);
    expect(duplicate.store.issuedTokens.map(({ id }) => id))
      .toEqual([...duplicate.store.issuedTokens.map(({ id }) => id)].sort());
  });
});

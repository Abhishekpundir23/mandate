import { describe, expect, it } from 'vitest';

import type { ActionProposal, Clause, ContractVersion } from '../domain/types';
import { evaluateAction, fingerprintAction } from './gate';

const source = { turnId: 'turn-1', quote: 'Only submit this application.' } as const;

const submitProposal: ActionProposal = {
  id: 'submit-application',
  stepId: 'step-2',
  tool: 'application',
  operation: 'submit',
  args: { applicationId: 'application:1', metadata: { b: 2, a: 1 } },
  effect: 'EXTERNAL_TRANSMIT',
  resource: 'application:1',
  fingerprint: 'caller-supplied-value-is-not-trusted',
};

function clause(id: string, kind: Clause['kind']): Clause {
  return {
    id,
    kind,
    statement: `${kind} application submission`,
    selector: {
      tool: 'application',
      operation: 'submit',
      resource: 'application:1',
      effect: 'EXTERNAL_TRANSMIT',
    },
    introducedIn: 1,
    source,
    ...(kind === 'NEEDS_CONFIRMATION' ? { afterConfirmation: 'MAY' as const } : {}),
  };
}

function version(clauses: readonly Clause[], versionNumber = 1): ContractVersion {
  return {
    version: versionNumber,
    parentVersion: versionNumber === 1 ? null : versionNumber - 1,
    turnId: source.turnId,
    source,
    clauses,
    hash: `version-${versionNumber}`,
  };
}

const versionWithMustNot = version([clause('deny-submit', 'MUST_NOT')]);
const versionWithRevocation = version([{
  id: 'revoke-submit',
  kind: 'REVOKED',
  statement: 'Submission authority was revoked.',
  introducedIn: 1,
  source,
  revokedSelector: clause('unused', 'MAY').selector!,
}]);
const versionNeedingConfirmation = version([clause('confirm-submit', 'NEEDS_CONFIRMATION')]);
const versionWithMay = version([clause('allow-submit', 'MAY')]);
const emptyVersion = version([]);

describe('deterministic action gate', () => {
  it.each([
    ['active MUST_NOT', versionWithMustNot, 'BLOCK'],
    ['matching REVOKED tombstone', versionWithRevocation, 'BLOCK'],
    ['unconfirmed conditional grant', versionNeedingConfirmation, 'CONFIRM'],
    ['matching MAY', versionWithMay, 'ALLOW'],
    ['no matching authority', emptyVersion, 'BLOCK'],
  ] as const)('%s yields %s', (_, contract, expected) => {
    expect(evaluateAction(contract, submitProposal).outcome).toBe(expected);
  });

  it('fails closed when MUST and MUST_NOT both match', () => {
    const decision = evaluateAction(version([
      clause('required-submit', 'MUST'),
      clause('deny-submit', 'MUST_NOT'),
    ]), submitProposal);

    expect(decision.outcome).toBe('BLOCK');
    expect(decision.reasons).toContain('Conflicting authority: denial wins');
  });

  it('requires the complete selector to match exactly', () => {
    const sendBob = {
      ...submitProposal,
      id: 'send-bob',
      tool: 'email',
      operation: 'send',
      args: { recipient: 'bob@example.test' },
      resource: 'recipient:bob',
    } satisfies ActionProposal;
    const sendAlice = {
      ...sendBob,
      id: 'send-alice',
      args: { recipient: 'alice@example.test' },
      resource: 'recipient:alice',
    } satisfies ActionProposal;
    const readBob = {
      ...sendBob,
      id: 'read-bob',
      effect: 'READ',
    } satisfies ActionProposal;
    const bobOnly = version([{
      ...clause('allow-send-bob', 'MAY'),
      selector: {
        tool: 'email',
        operation: 'send',
        resource: 'recipient:bob',
        effect: 'EXTERNAL_TRANSMIT',
      },
    }]);

    expect(evaluateAction(bobOnly, sendBob).outcome).toBe('ALLOW');
    expect(evaluateAction(bobOnly, sendAlice).outcome).toBe('BLOCK');
    expect(evaluateAction(bobOnly, readBob).outcome).toBe('BLOCK');
  });

  it('rejects a compound operation before matching an otherwise permissive clause', () => {
    const compoundProposal = {
      ...submitProposal,
      operation: 'saveAndContinue',
      effect: 'DRAFT_WRITE',
    } satisfies ActionProposal;
    const permissiveVersion = version([{
      ...clause('allow-compound', 'MAY'),
      selector: {
        tool: compoundProposal.tool,
        operation: compoundProposal.operation,
        resource: compoundProposal.resource,
        effect: compoundProposal.effect,
      },
    }]);

    const decision = evaluateAction(permissiveVersion, compoundProposal);

    expect(decision.outcome).toBe('BLOCK');
    expect(decision.matchedClauseIds).toEqual([]);
    expect(decision.reasons).toContain('Composite operations are not allowed');
  });

  it('normalizes recursively sorted arguments and ignores an untrusted input fingerprint', () => {
    const reordered = {
      ...submitProposal,
      tool: ' application ',
      operation: ' submit ',
      resource: ' application:1 ',
      args: { metadata: { a: 1, b: 2 }, applicationId: 'application:1' },
      fingerprint: 'different-untrusted-value',
    } satisfies ActionProposal;

    expect(fingerprintAction(reordered)).toBe(fingerprintAction(submitProposal));
    expect(fingerprintAction({
      ...reordered,
      args: { ...reordered.args, applicationId: 'application:2' },
    })).not.toBe(fingerprintAction(submitProposal));
  });

  it('returns stable-sorted trace details without mutating the caller proposal', () => {
    const mutableArgs = { applicationId: 'application:1', nested: { z: 2, a: 1 } };
    const callerProposal = { ...submitProposal, args: mutableArgs };
    const contract = version([
      clause('z-allow', 'MAY'),
      clause('a-allow', 'MAY'),
    ]);

    const decision = evaluateAction(contract, callerProposal);

    expect(decision.matchedClauseIds).toEqual(['a-allow', 'z-allow']);
    expect([...decision.reasons]).toEqual([...decision.reasons].sort());
    expect(Object.isFrozen(callerProposal)).toBe(false);
    expect(Object.isFrozen(mutableArgs)).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

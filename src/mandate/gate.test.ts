import { describe, expect, it } from 'vitest';

import type {
  ActionProposal,
  CapabilityValidationPort,
  Clause,
  ContractVersion,
  Effect,
  JsonValue,
} from '../domain/types';
import { emptyConfirmationStore } from './confirmation';
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

function stringArg(args: Readonly<Record<string, JsonValue>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const validateCapability: CapabilityValidationPort = (proposal) => {
  const knownTools = new Set(['application', 'email']);
  if (!knownTools.has(proposal.tool)) {
    return { ok: false, reason: 'Unknown tool' };
  }

  let effects: readonly Effect[];
  let resource: string | undefined;
  if (proposal.tool === 'application' && proposal.operation === 'submit') {
    effects = ['EXTERNAL_TRANSMIT'];
    resource = stringArg(proposal.args, 'applicationId');
  } else if (proposal.tool === 'application' && proposal.operation === 'saveAndContinue') {
    effects = ['DRAFT_WRITE', 'EXTERNAL_TRANSMIT'];
    resource = stringArg(proposal.args, 'applicationId');
  } else if (proposal.tool === 'email' && proposal.operation === 'send') {
    effects = ['EXTERNAL_TRANSMIT'];
    const recipient = stringArg(proposal.args, 'recipient');
    resource = recipient === undefined ? undefined : `recipient:${recipient.split('@')[0]}`;
  } else {
    return { ok: false, reason: 'Unknown operation' };
  }

  if (resource === undefined) {
    return { ok: false, reason: 'Invalid capability arguments' };
  }
  return { ok: true, effects, resource };
};

function gate(contract: ContractVersion, proposal: ActionProposal) {
  return evaluateAction({
    version: contract,
    proposal,
    validateCapability,
    confirmationStore: emptyConfirmationStore,
  }).decision;
}

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
    expect(gate(contract, submitProposal).outcome).toBe(expected);
  });

  it('fails closed when MUST and MUST_NOT both match', () => {
    const decision = gate(version([
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

    expect(gate(bobOnly, sendBob).outcome).toBe('ALLOW');
    expect(gate(bobOnly, sendAlice).outcome).toBe('BLOCK');
    expect(gate(bobOnly, readBob).outcome).toBe('BLOCK');
  });

  it.each([
    ['tool', { ...submitProposal, tool: 'invented' }, 'Unknown tool'],
    ['operation', { ...submitProposal, operation: 'invented' }, 'Unknown operation'],
  ] as const)('blocks a well-formed but unknown %s before clause matching', (_, proposal, reason) => {
    const permissiveVersion = version([{
      ...clause('invented-grant', 'MAY'),
      selector: {
        tool: proposal.tool,
        operation: proposal.operation,
        resource: proposal.resource,
        effect: proposal.effect,
      },
    }]);

    const decision = gate(permissiveVersion, proposal);

    expect(decision.outcome).toBe('BLOCK');
    expect(decision.matchedClauseIds).toEqual([]);
    expect(decision.reasons).toContain(reason);
  });

  it('fails closed when the capability validator returns a malformed rejection', () => {
    const malformedValidator = (() => ({ ok: false, reason: '' })) as CapabilityValidationPort;

    const result = evaluateAction({
      version: version([clause('allow-submit', 'MAY')]),
      proposal: submitProposal,
      validateCapability: malformedValidator,
      confirmationStore: emptyConfirmationStore,
    });

    expect(result.decision.outcome).toBe('BLOCK');
    expect(result.decision.matchedClauseIds).toEqual([]);
    expect(result.decision.reasons).toContain('Capability validation failed closed');
  });

  it('blocks when validated arguments derive a different resource', () => {
    const sendBob = {
      ...submitProposal,
      tool: 'email',
      operation: 'send',
      args: { recipient: 'bob@example.test' },
      resource: 'recipient:bob',
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
    const aliceArgsWithBobResource = {
      ...sendBob,
      args: { recipient: 'alice@example.test' },
    } satisfies ActionProposal;

    const decision = gate(bobOnly, aliceArgsWithBobResource);

    expect(decision.outcome).toBe('BLOCK');
    expect(decision.matchedClauseIds).toEqual([]);
    expect(decision.reasons).toContain('Capability-derived resource does not match proposal resource');
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

    const decision = gate(permissiveVersion, compoundProposal);

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

    const decision = gate(contract, callerProposal);

    expect(decision.matchedClauseIds).toEqual(['a-allow', 'z-allow']);
    expect([...decision.reasons]).toEqual([...decision.reasons].sort());
    expect(Object.isFrozen(callerProposal)).toBe(false);
    expect(Object.isFrozen(mutableArgs)).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('does not freeze or mutate caller-owned contract clauses and selectors', () => {
    const selector = {
      tool: 'application',
      operation: 'submit',
      resource: 'application:1',
      effect: 'EXTERNAL_TRANSMIT' as const,
    };
    const callerClause: Clause = {
      ...clause('caller-allow', 'MAY'),
      selector,
    };
    const callerVersion = version([callerClause]);

    const decision = gate(callerVersion, submitProposal);

    expect(decision.outcome).toBe('ALLOW');
    expect(Object.isFrozen(callerVersion)).toBe(false);
    expect(Object.isFrozen(callerVersion.clauses)).toBe(false);
    expect(Object.isFrozen(callerClause)).toBe(false);
    expect(Object.isFrozen(selector)).toBe(false);
    expect(selector).toEqual({
      tool: 'application',
      operation: 'submit',
      resource: 'application:1',
      effect: 'EXTERNAL_TRANSMIT',
    });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'ALLOW'],
  ] as const)('blocks a confirmation clause with %s afterConfirmation', (_, afterConfirmation) => {
    const malformedClause = {
      ...clause('confirm-submit', 'NEEDS_CONFIRMATION'),
      ...(afterConfirmation === undefined ? {} : { afterConfirmation }),
    } as Clause;
    if (afterConfirmation === undefined) {
      delete (malformedClause as { afterConfirmation?: unknown }).afterConfirmation;
    }

    const decision = gate(version([malformedClause]), submitProposal);

    expect(decision.outcome).toBe('BLOCK');
    expect(decision.reasons).toContain('Malformed confirmation authority: blocked closed');
  });
});

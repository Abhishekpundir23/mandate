import { describe, expect, it } from 'vitest';

import { compilerSupportMetadata, compileSupportedTurn } from './compiler';

import type { Clause } from '../domain/types';

const context = {
  baseVersion: 1,
  actions: [
    {
      id: 'submit-application',
      phrases: ['submit the application'],
      statement: 'Submit the application',
      selector: { tool: 'application', operation: 'submit', effect: 'EXTERNAL_TRANSMIT' as const },
    },
  ],
  activeClauses: [],
};

const purchaseMay: Clause = {
  id: 'purchase-may',
  kind: 'MAY',
  statement: 'Buy an item',
  selector: { tool: 'commerce', operation: 'buy', effect: 'EXTERNAL_TRANSMIT' },
  introducedIn: 1,
  source: { turnId: 't1', quote: 'You may buy the item.' },
};

const purchaseContext = {
  baseVersion: 1,
  actions: [{
    id: 'buy-anything',
    phrases: ['buy anything'],
    statement: 'Buy anything',
    selector: purchaseMay.selector!,
  }],
  activeClauses: [purchaseMay],
};

const publishContext = {
  baseVersion: 2,
  actions: [{
    id: 'publish-release',
    phrases: ['publish now'],
    statement: 'Publish the release',
    selector: { tool: 'release', operation: 'publish', effect: 'PUBLISH' as const },
  }],
  activeClauses: [],
};

describe('supported-language intent compiler', () => {
  it('publishes an immutable, honest support boundary', () => {
    expect(compilerSupportMetadata).toEqual({
      mode: 'DETERMINISTIC_SUPPORTED_LANGUAGE',
      label: 'Supported language only',
      arbitraryLanguage: false,
      confidenceLevels: [1, 0.9, 0.6],
    });
    expect(Object.isFrozen(compilerSupportMetadata)).toBe(true);
    expect(Object.isFrozen(compilerSupportMetadata.confidenceLevels)).toBe(true);
  });

  it('recursively freezes compiled diffs at the public boundary', () => {
    const diff = compileSupportedTurn(
      { id: 't3', text: 'Do not submit the application.' },
      context,
    );

    expect(Object.isFrozen(diff)).toBe(true);
    expect(Object.isFrozen(diff.ops)).toBe(true);
    expect(Object.isFrozen(diff.ops[0])).toBe(true);
    expect(() => {
      (diff.ops as unknown as { push: (value: unknown) => number }).push({
        op: 'NO_CHANGE',
        reason: 'DISCUSSION',
      });
    }).toThrow(TypeError);
  });

  it('does not freeze or retain caller-owned action selectors', () => {
    const selector = { tool: 'release', operation: 'publish', effect: 'PUBLISH' as const };
    const callerContext = {
      baseVersion: 1,
      actions: [{
        id: 'publish-release',
        phrases: ['publish now'],
        statement: 'Publish the release',
        selector,
      }],
      activeClauses: [],
    };

    const diff = compileSupportedTurn({ id: 'release-1', text: 'Publish now.' }, callerContext);

    expect(Object.isFrozen(selector)).toBe(false);
    selector.operation = 'preview';
    expect(diff.ops[0]).toMatchObject({ clause: { selector: { operation: 'publish' } } });
  });

  it('keeps conversational approval from changing authority', () => {
    expect(compileSupportedTurn({ id: 't2', text: 'Looks good.' }, context).ops)
      .toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
  });

  it('adds an explicit denial for a supported action', () => {
    expect(compileSupportedTurn({ id: 't3', text: 'Do not submit the application.' }, context).ops[0])
      .toMatchObject({
        op: 'ADD',
        clause: {
          kind: 'MUST_NOT',
          source: { turnId: 't3', quote: 'Do not submit the application.' },
          confidence: 1,
        },
      });
  });

  it('revokes an existing grant when an explicit denial narrows it', () => {
    expect(compileSupportedTurn(
      { id: 't4', text: 'Actually, do not buy anything yet.' },
      purchaseContext,
    ).ops[0]).toMatchObject({
      op: 'REVOKE',
      tombstone: {
        kind: 'REVOKED',
        targetClauseIds: ['purchase-may'],
        source: { turnId: 't4', quote: 'Actually, do not buy anything yet.' },
      },
    });
  });

  it("distinguishes 'don't forget to send' from 'don't send'", () => {
    const emailContext = {
      baseVersion: 0,
      actions: [{
        id: 'send-email',
        phrases: ['send the email'],
        statement: 'Send the email',
        selector: { tool: 'email', operation: 'send', effect: 'EXTERNAL_TRANSMIT' as const },
      }],
      activeClauses: [],
    };

    expect(compileSupportedTurn(
      { id: 'email-1', text: "Don't forget to send the email." },
      emailContext,
    ).ops[0]).toMatchObject({ op: 'ADD', clause: { kind: 'MUST', confidence: 0.9 } });
    expect(compileSupportedTurn(
      { id: 'email-2', text: "Don't send the email." },
      emailContext,
    ).ops[0]).toMatchObject({ op: 'ADD', clause: { kind: 'MUST_NOT', confidence: 1 } });
  });

  it('compiles a supported imperative as a requirement', () => {
    expect(compileSupportedTurn({ id: 'release-1', text: 'Publish now.' }, publishContext).ops[0])
      .toMatchObject({ op: 'ADD', clause: { kind: 'MUST', confidence: 0.9 } });
  });

  it('compiles an explicit supported allowance without making it required', () => {
    expect(compileSupportedTurn(
      { id: 't5', text: 'You may submit the application.' },
      context,
    ).ops[0]).toMatchObject({ op: 'ADD', clause: { kind: 'MAY', confidence: 1 } });
  });

  it('does not treat quoted page text as user authority', () => {
    expect(compileSupportedTurn(
      { id: 'release-2', text: 'The page says “publish now”' },
      publishContext,
    ).ops).toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
    expect(compileSupportedTurn(
      { id: 'release-3', text: "The page says “don't forget to publish now”" },
      publishContext,
    ).ops).toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
  });

  it('does not authorize straight-single-quoted page content', () => {
    expect(compileSupportedTurn(
      { id: 'page-1', text: "The page says 'you may submit the application'" },
      context,
    ).ops).toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
  });

  it('does not classify attributed tool output as user authority', () => {
    expect(compileSupportedTurn(
      { id: 'tool-1', text: "Tool output: don't submit the application" },
      context,
    ).ops).toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
  });

  it('rejects turns explicitly marked as untrusted data', () => {
    expect(compileSupportedTurn(
      { id: 'tool-2', text: 'You may submit the application.', origin: 'UNTRUSTED' },
      context,
    ).ops).toEqual([{ op: 'NO_CHANGE', reason: 'IRRELEVANT' }]);
  });

  it('fails closed on an ambiguous action reference', () => {
    expect(compileSupportedTurn({ id: 't6', text: 'Finish it.' }, context).ops)
      .toEqual([{ op: 'NO_CHANGE', reason: 'AMBIGUOUS' }]);
  });

  it('does not authorize an imperative outside the supplied vocabulary', () => {
    expect(compileSupportedTurn({ id: 't7', text: 'Archive the database.' }, context).ops)
      .toEqual([{ op: 'NO_CHANGE', reason: 'IRRELEVANT' }]);
  });

  it('adds an action-bound confirmation requirement from an explicit form', () => {
    const emailContext = {
      baseVersion: 3,
      actions: [{
        id: 'send-email',
        phrases: ['send the email'],
        statement: 'Send the email',
        selector: { tool: 'email', operation: 'send', effect: 'EXTERNAL_TRANSMIT' as const },
      }],
      activeClauses: [],
    };

    expect(compileSupportedTurn(
      { id: 'email-3', text: 'Ask me before you send the email.' },
      emailContext,
    ).ops[0]).toMatchObject({
      op: 'ADD',
      clause: {
        kind: 'NEEDS_CONFIRMATION',
        afterConfirmation: 'MAY',
        confidence: 1,
        source: { turnId: 'email-3', quote: 'Ask me before you send the email.' },
      },
    });
  });

  it('replaces a supported entity grant when both entities are explicit', () => {
    const sendAlice: Clause = {
      id: 'send-alice',
      kind: 'MAY',
      statement: 'Send to Alice',
      selector: { tool: 'email', operation: 'send', resource: 'recipient:alice', effect: 'EXTERNAL_TRANSMIT' },
      introducedIn: 1,
      source: { turnId: 'email-1', quote: 'You may send to Alice.' },
    };
    const recipientContext = {
      baseVersion: 1,
      actions: [
        {
          id: 'send-alice',
          phrases: ['send to alice'],
          entityTerms: ['alice'],
          statement: 'Send to Alice',
          selector: sendAlice.selector!,
        },
        {
          id: 'send-bob',
          phrases: ['send to bob'],
          entityTerms: ['bob'],
          statement: 'Send to Bob',
          selector: { tool: 'email', operation: 'send', resource: 'recipient:bob', effect: 'EXTERNAL_TRANSMIT' as const },
        },
      ],
      activeClauses: [sendAlice],
    };

    expect(compileSupportedTurn(
      { id: 'email-2', text: 'Send to Bob instead of Alice.' },
      recipientContext,
    ).ops[0]).toMatchObject({
      op: 'REPLACE',
      targetClauseIds: ['send-alice'],
      replacement: {
        kind: 'MAY',
        selector: { resource: 'recipient:bob' },
        source: { turnId: 'email-2', quote: 'Send to Bob instead of Alice.' },
        confidence: 1,
      },
    });
  });

  it.each(['MUST_NOT', 'NEEDS_CONFIRMATION'] as const)(
    'does not replace an active %s constraint with a MAY grant',
    (kind) => {
      const protectedAlice: Clause = {
        id: `send-alice-${kind.toLowerCase()}`,
        kind,
        statement: 'Protect sending to Alice',
        selector: { tool: 'email', operation: 'send', resource: 'recipient:alice', effect: 'EXTERNAL_TRANSMIT' },
        introducedIn: 1,
        source: { turnId: 'email-1', quote: 'Protect sending to Alice.' },
        ...(kind === 'NEEDS_CONFIRMATION' ? { afterConfirmation: 'MAY' as const } : {}),
      };
      const protectedContext = {
        baseVersion: 1,
        actions: [
          {
            id: 'send-alice',
            phrases: ['send to alice'],
            entityTerms: ['alice'],
            statement: 'Send to Alice',
            selector: protectedAlice.selector!,
          },
          {
            id: 'send-bob',
            phrases: ['send to bob'],
            entityTerms: ['bob'],
            statement: 'Send to Bob',
            selector: { tool: 'email', operation: 'send', resource: 'recipient:bob', effect: 'EXTERNAL_TRANSMIT' as const },
          },
        ],
        activeClauses: [protectedAlice],
      };

      expect(compileSupportedTurn(
        { id: 'email-2', text: 'Send to Bob instead of Alice.' },
        protectedContext,
      ).ops[0]).toMatchObject({ op: 'ADD', clause: { kind: 'MUST' } });
    },
  );
});

import { describe, expect, it } from 'vitest';

import { canonicalize } from '../domain/canonical';
import type { Clause, IntentDiff, JsonValue } from '../domain/types';
import { activeClauses, appendVersion, createLedger } from './ledger';

const purchaseMay: Clause = {
  id: 'purchase-may',
  kind: 'MAY',
  statement: 'Buy the item',
  selector: { tool: 'commerce', operation: 'buy', resource: 'item:1', effect: 'EXTERNAL_TRANSMIT' },
  introducedIn: 1,
  source: { turnId: 't1', quote: 'You may buy the item.' },
};

const revokePurchaseDiff: IntentDiff = {
  baseVersion: 1,
  turnId: 't2',
  source: { turnId: 't2', quote: 'Do not buy the item.' },
  ops: [{
    op: 'REVOKE',
    tombstone: {
      id: 'purchase-revoked',
      kind: 'REVOKED',
      statement: 'Purchase permission revoked',
      targetClauseIds: [purchaseMay.id],
      revokedSelector: purchaseMay.selector!,
      source: { turnId: 't2', quote: 'Do not buy the item.' },
    },
  }],
};

const draftMust: Clause = {
  id: 'draft-must',
  kind: 'MUST',
  statement: 'Save the draft',
  selector: { tool: 'application', operation: 'saveDraft', effect: 'DRAFT_WRITE' },
  introducedIn: 1,
  source: { turnId: 'draft-1', quote: 'Save the draft.' },
};

const discussionDiff: IntentDiff = {
  baseVersion: 1,
  turnId: 'draft-2',
  source: { turnId: 'draft-2', quote: 'Looks good.' },
  ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
};

describe('append-only authority ledger', () => {
  it('keeps prior versions byte-stable when a revocation is appended', () => {
    const before = createLedger([purchaseMay], 't1');
    const snapshot = canonicalize(before[0] as unknown as JsonValue);
    const after = appendVersion(before, revokePurchaseDiff);

    expect(canonicalize(after[0] as unknown as JsonValue)).toBe(snapshot);
    expect(after).toHaveLength(2);
    expect(activeClauses(after[1]!)).not.toContainEqual(expect.objectContaining({ id: purchaseMay.id }));
    expect(activeClauses(after[1]!)).toContainEqual(expect.objectContaining({
      id: 'purchase-revoked',
      kind: 'REVOKED',
    }));
    expect(after[1]?.clauses).toContainEqual(expect.objectContaining({ id: 'purchase-revoked', kind: 'REVOKED' }));
  });

  it('records NO_CHANGE as a version with an unchanged active contract', () => {
    const versions = appendVersion(createLedger([draftMust], 'draft-1'), discussionDiff);

    expect(versions[1]?.clauses).toEqual(versions[0]?.clauses);
    expect(versions[1]?.hash).not.toBe(versions[0]?.hash);
  });

  it('records and hashes the exact source quote for NO_CHANGE', () => {
    const before = createLedger([draftMust], 'draft-1');
    const looksGood = appendVersion(before, discussionDiff);
    const looksBad = appendVersion(before, {
      ...discussionDiff,
      source: { turnId: 'draft-2', quote: 'Looks bad.' },
    });

    expect(looksGood[1]?.source).toEqual({ turnId: 'draft-2', quote: 'Looks good.' });
    expect(looksGood[1]?.hash).not.toBe(looksBad[1]?.hash);
  });

  it('tombstones every REPLACE target and adds one replacement', () => {
    const secondGrant: Clause = {
      ...purchaseMay,
      id: 'purchase-may-backup',
      statement: 'Buy the backup item',
      selector: { ...purchaseMay.selector, resource: 'item:2' },
    };
    const replaceDiff: IntentDiff = {
      baseVersion: 1,
      turnId: 't2',
      source: { turnId: 't2', quote: 'Buy only the item for Bob instead.' },
      ops: [{
        op: 'REPLACE',
        targetClauseIds: [purchaseMay.id, secondGrant.id],
        replacement: {
          id: 'purchase-bob-only',
          kind: 'MAY',
          statement: 'Buy the item for Bob',
          selector: { ...purchaseMay.selector, resource: 'item:bob' },
          source: { turnId: 't2', quote: 'Buy only the item for Bob instead.' },
        },
      }],
    };

    const versions = appendVersion(createLedger([purchaseMay, secondGrant], 't1'), replaceDiff);
    const latest = versions[1]!;

    expect(latest.clauses.filter((clause) => clause.kind === 'REVOKED'))
      .toHaveLength(2);
    expect(activeClauses(latest).map((clause) => clause.id))
      .toEqual(expect.arrayContaining(['purchase-bob-only']));
    expect(activeClauses(latest).map((clause) => clause.id))
      .not.toEqual(expect.arrayContaining([purchaseMay.id, secondGrant.id]));
  });

  it('adds a clause at the newly appended version', () => {
    const addDiff: IntentDiff = {
      baseVersion: 1,
      turnId: 'draft-2',
      source: { turnId: 'draft-2', quote: 'Do not submit.' },
      ops: [{
        op: 'ADD',
        clause: {
          id: 'submit-denied',
          kind: 'MUST_NOT',
          statement: 'Do not submit',
          selector: { tool: 'application', operation: 'submit', effect: 'EXTERNAL_TRANSMIT' },
          source: { turnId: 'draft-2', quote: 'Do not submit.' },
        },
      }],
    };

    const versions = appendVersion(createLedger([draftMust], 'draft-1'), addDiff);

    expect(versions[1]?.clauses).toContainEqual(expect.objectContaining({
      id: 'submit-denied',
      kind: 'MUST_NOT',
      introducedIn: 2,
    }));
  });

  it('rejects a diff based on a stale contract version', () => {
    const staleDiff: IntentDiff = { ...discussionDiff, baseVersion: 0 };

    expect(() => appendVersion(createLedger([draftMust], 'draft-1'), staleDiff))
      .toThrow(/stale base version/i);
  });

  it('rejects a duplicated source turn', () => {
    const duplicateTurnDiff: IntentDiff = {
      baseVersion: 1,
      turnId: 'draft-1',
      source: { turnId: 'draft-1', quote: 'Looks good.' },
      ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
    };

    expect(() => appendVersion(createLedger([draftMust], 'draft-1'), duplicateTurnDiff))
      .toThrow(/duplicate source turn/i);
  });

  it('rejects a revocation whose target id does not exist', () => {
    const missingTargetDiff: IntentDiff = {
      ...revokePurchaseDiff,
      ops: [{
        op: 'REVOKE',
        tombstone: {
          id: 'missing-revocation',
          kind: 'REVOKED',
          statement: 'Missing clause revoked',
          targetClauseIds: ['missing-clause'],
          source: { turnId: 't2', quote: 'Revoke the missing clause.' },
        },
      }],
    };

    expect(() => appendVersion(createLedger([purchaseMay], 't1'), missingTargetDiff))
      .toThrow(/target.*does not exist/i);
  });

  it('recursively freezes every returned ledger value', () => {
    const versions = appendVersion(createLedger([draftMust], 'draft-1'), discussionDiff);

    expect(Object.isFrozen(versions)).toBe(true);
    expect(Object.isFrozen(versions[0])).toBe(true);
    expect(Object.isFrozen(versions[0]?.clauses)).toBe(true);
    expect(Object.isFrozen(versions[0]?.clauses[0]?.selector)).toBe(true);
    expect(() => {
      (versions[0]?.clauses as Clause[]).push(purchaseMay);
    }).toThrow(TypeError);
  });

  it('does not freeze caller-owned values when selecting active clauses', () => {
    const selector = { tool: 'commerce', operation: 'buy', effect: 'EXTERNAL_TRANSMIT' as const };
    const callerClause: Clause = { ...purchaseMay, selector };
    const callerVersion = {
      version: 1,
      parentVersion: null,
      turnId: 't1',
      source: purchaseMay.source,
      clauses: [callerClause],
      hash: 'caller-version',
    };

    const selected = activeClauses(callerVersion);

    expect(selected).toEqual([callerClause]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected[0])).toBe(true);
    expect(Object.isFrozen(callerVersion)).toBe(false);
    expect(Object.isFrozen(callerVersion.clauses)).toBe(false);
    expect(Object.isFrozen(callerClause)).toBe(false);
    expect(Object.isFrozen(selector)).toBe(false);
  });

  it('resolves a selector-only tombstone against matching prior clauses', () => {
    const selectorRevocation: IntentDiff = {
      baseVersion: 1,
      turnId: 't2',
      source: { turnId: 't2', quote: 'Do not buy anything.' },
      ops: [{
        op: 'REVOKE',
        tombstone: {
          id: 'all-purchases-revoked',
          kind: 'REVOKED',
          statement: 'All purchases revoked',
          revokedSelector: { operation: 'buy' },
          source: { turnId: 't2', quote: 'Do not buy anything.' },
        },
      }],
    };

    const versions = appendVersion(createLedger([purchaseMay], 't1'), selectorRevocation);

    expect(activeClauses(versions[1]!).map((clause) => clause.id))
      .not.toContain(purchaseMay.id);
  });

  it.each(['MUST_NOT', 'NEEDS_CONFIRMATION', 'REVOKED'] as const)(
    'rejects REPLACE against a protected %s clause',
    (kind) => {
      const protectedClause: Clause = {
        id: `protected-${kind.toLowerCase()}`,
        kind,
        statement: 'Protected authority',
        selector: { tool: 'email', operation: 'send', effect: 'EXTERNAL_TRANSMIT' },
        introducedIn: 1,
        source: { turnId: 't1', quote: 'Protect this action.' },
        ...(kind === 'NEEDS_CONFIRMATION' ? { afterConfirmation: 'MAY' as const } : {}),
        ...(kind === 'REVOKED'
          ? { targetClauseIds: ['prior-authority'], revokedSelector: { operation: 'send' } }
          : {}),
      };
      const replaceProtected: IntentDiff = {
        baseVersion: 1,
        turnId: 't2',
        source: { turnId: 't2', quote: 'Replace it.' },
        ops: [{
          op: 'REPLACE',
          targetClauseIds: [protectedClause.id],
          replacement: {
            id: 'unsafe-may',
            kind: 'MAY',
            statement: 'Unsafe replacement',
            selector: protectedClause.selector!,
            source: { turnId: 't2', quote: 'Replace it.' },
          },
        }],
      };

      expect(() => appendVersion(createLedger([protectedClause], 't1'), replaceProtected))
        .toThrow(new RegExp(`cannot replace.*${kind}`, 'i'));
    },
  );

  it('rejects append to an empty ledger and mismatched diff provenance', () => {
    expect(() => appendVersion([], discussionDiff)).toThrow(/empty authority ledger/i);
    expect(() => appendVersion(createLedger([draftMust], 'draft-1'), {
      ...discussionDiff,
      source: { turnId: 'other-turn', quote: discussionDiff.source.quote },
    })).toThrow(/source turn.*does not match/i);
  });

  it('uses a blank source only when no initial clause belongs to the ledger turn', () => {
    const versions = createLedger([purchaseMay], 'different-turn');

    expect(versions[0]?.source).toEqual({ turnId: 'different-turn', quote: '' });
  });

  it('copies replacement confidence into generated tombstones without inventing a selector', () => {
    const selectorless: Clause = {
      id: 'selectorless-must',
      kind: 'MUST',
      statement: 'Selectorless requirement',
      introducedIn: 1,
      source: draftMust.source,
    };
    const diff: IntentDiff = {
      baseVersion: 1,
      turnId: 'draft-2',
      source: { turnId: 'draft-2', quote: 'Replace the requirement.' },
      ops: [{
        op: 'REPLACE',
        targetClauseIds: [selectorless.id],
        replacement: {
          id: 'replacement-must',
          kind: 'MUST',
          statement: 'Replacement requirement',
          confidence: 0.9,
          source: { turnId: 'draft-2', quote: 'Replace the requirement.' },
        },
      }],
    };

    const latest = appendVersion(createLedger([selectorless], 'draft-1'), diff).at(-1)!;
    const tombstone = latest.clauses.find(({ kind }) => kind === 'REVOKED');

    expect(tombstone).toMatchObject({ confidence: 0.9, targetClauseIds: [selectorless.id] });
    expect(tombstone).not.toHaveProperty('revokedSelector');
  });
});

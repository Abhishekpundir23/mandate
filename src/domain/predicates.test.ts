import { describe, expect, it } from 'vitest';

import { evaluatePredicate, getAtPath } from './predicates';

describe('predicates', () => {
  it('evaluates exact set and scalar predicates independently of production builders', () => {
    const state = { sent: [], draftSaved: true, members: ['Ana', 'Priya'] };

    expect(evaluatePredicate(state, { op: 'eq', path: 'draftSaved', value: true })).toBe(true);
    expect(evaluatePredicate(state, { op: 'setEquals', path: 'members', value: ['Priya', 'Ana'] })).toBe(true);
    expect(evaluatePredicate(state, { op: 'absent', path: 'submittedAt' })).toBe(true);
  });

  it('reads dotted paths and evaluates literal contains and lte operators', () => {
    const state = { receipt: { retries: 2 }, tags: ['draft', 'local'] };

    expect(getAtPath(state, 'receipt.retries')).toBe(2);
    expect(evaluatePredicate(state, { op: 'contains', path: 'tags', value: 'draft' })).toBe(true);
    expect(evaluatePredicate(state, { op: 'lte', path: 'receipt.retries', value: 2 })).toBe(true);
  });
});

import type { Clause, ClauseKind, IntentDiff } from '../../src/domain/types';

export function clause(id: string, kind: ClauseKind = 'MAY', extra: Partial<Omit<Clause, 'introducedIn'>> = {}): Omit<Clause, 'introducedIn'> {
  return { id, kind, statement: 'Synthetic policy', source: { turnId: 'turn-1', quote: 'Synthetic policy' },
    selector: { tool: 'git', operation: 'commit', resource: 'repository:mandate' }, ...extra };
}

export function diff(baseVersion: number, turnId: string, ops: IntentDiff['ops']): IntentDiff {
  return { baseVersion, turnId, source: { turnId, quote: 'Synthetic policy' }, ops };
}

export function makePolicy(overrides: Partial<ReturnType<typeof defaultPolicy>> = {}) {
  return { ...defaultPolicy(), ...overrides };
}

function defaultPolicy() {
  return {
    schemaVersion: 1 as const, policyId: 'synthetic',
    repositories: [{ id: 'mandate', remotes: ['origin'] }],
    diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('commit') }])],
  };
}

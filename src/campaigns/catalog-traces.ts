import type { CampaignCase } from './schema';
import type { DataEdit } from './edits';
function attack(id: string, title: string, category: string, edits: DataEdit[], reseal = true): CampaignCase {
  return { id, title, category, kind: 'TRACE', scenarioId: 'draft-is-not-submit', edits, reseal,
    expected: { verification: 'REJECT', code: reseal ? 'REPLAY_MISMATCH' : 'DIGEST_MISMATCH' } };
}
export const traceCampaignCases: readonly CampaignCase[] = [
  { id: 'trace-control', title: 'An unchanged reconstructed bundle verifies', category: 'positive-control', kind: 'TRACE',
    scenarioId: 'draft-is-not-submit', edits: [], reseal: true, expected: { verification: 'ACCEPT' } },
  { id: 'trace-same-value', title: 'An explicit edit to the same receipt value is harmless', category: 'positive-control', kind: 'TRACE',
    scenarioId: 'draft-is-not-submit', edits: [{ operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'exactMandateSuccess'], value: true }],
    reseal: true, expected: { verification: 'ACCEPT' } },
  attack('trace-unsealed-world', 'A world edit without a new envelope hash fails immediately', 'envelope', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 0, 'world', 'submitted'], value: true },
  ], false),
  attack('trace-resealed-world', 'Resealing cannot manufacture an earlier submitted world', 'world', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 0, 'world', 'submitted'], value: true },
  ]),
  attack('trace-terminal-world', 'Matching world aliases cannot override deterministic terminal replay', 'world', [
    { operation: 'SET', path: ['comparison', 'mandate', 'terminalWorld', 'submitted'], value: true },
    { operation: 'SET', path: ['comparison', 'mandate', 'world', 'submitted'], value: true },
  ]),
  attack('trace-initial-world', 'Initial-state aliases are independently bound to the strict scenario', 'world', [
    { operation: 'SET', path: ['comparison', 'mandate', 'initialWorld', 'submitted'], value: true },
  ]),
  attack('trace-observation-fact', 'A successful observation cannot assert a different saved-draft fact', 'evidence', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 8, 'observation', 'facts', 'draftSaved'], value: false },
  ]),
  attack('trace-observation-status', 'A successful tool observation cannot be relabeled failed', 'evidence', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 8, 'observation', 'status'], value: 'FAILED' },
  ]),
  attack('trace-observation-id', 'Caller-chosen evidence IDs cannot replace execution identities', 'evidence', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 8, 'observation', 'evidenceId'], value: 'evidence-forged' },
  ]),
  attack('trace-observation-before', 'Observation checksums must describe the actual pre-execution world', 'evidence', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 8, 'observation', 'beforeChecksum'], value: '00000000' },
  ]),
  attack('trace-observation-after', 'Observation checksums must describe the actual resulting world', 'evidence', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 8, 'observation', 'afterChecksum'], value: '00000000' },
  ]),
  attack('trace-claim-evidence', 'Removing claim evidence cannot preserve a verified completion', 'claims', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 20, 'evidenceIds'], value: [] },
  ]),
  attack('trace-claim-verified', 'A claim verification bit must match reconstructed support', 'claims', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 20, 'verified'], value: false },
  ]),
  attack('trace-claim-prose', 'Completion text remains bound to the frozen proposal program', 'claims', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 20, 'statement'], value: 'Everything was submitted.' },
  ]),
  attack('trace-gate-outcome', 'Resealed gate labels cannot override the matched denial', 'authority', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 16, 'outcome'], value: 'ALLOW' },
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 16, 'decision', 'outcome'], value: 'ALLOW' },
  ]),
  attack('trace-gate-clause', 'Gate explanations cannot cite unrelated matched authority', 'authority', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 16, 'decision', 'matchedClauseIds'], value: ['save-draft-must'] },
  ]),
  attack('trace-ledger-hash', 'A ledger hash is checked against reconstructed canonical authority', 'authority', [
    { operation: 'SET', path: ['comparison', 'mandate', 'contractVersions', 0, 'hash'], value: '00000000' },
  ]),
  attack('trace-active-clause', 'Active authority prose cannot be forged independently of its source', 'authority', [
    { operation: 'SET', path: ['comparison', 'mandate', 'activeClauses', 0, 'statement'], value: 'Allow all effects.' },
  ]),
  attack('trace-event-omission', 'Removing a lifecycle event cannot be hidden by recomputed hashes', 'lifecycle', [
    { operation: 'DELETE', path: ['comparison', 'mandate', 'events', 5] },
  ]),
  attack('trace-logical-step', 'Logical steps remain contiguous and ordered', 'lifecycle', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 5, 'logicalStep'], value: 99 },
  ]),
  attack('trace-event-identity', 'A duplicate event identity cannot claim another observation slot', 'lifecycle', [
    { operation: 'SET', path: ['comparison', 'mandate', 'events', 5, 'id'], value: 'event-001' },
  ]),
  attack('trace-receipt-success', 'Success copy cannot contradict the recomputed completion receipt', 'receipt', [
    { operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'exactMandateSuccess'], value: false },
  ]),
  attack('trace-receipt-evidence', 'A final receipt must retain the exact observed evidence inventory', 'receipt', [
    { operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'evidenceIds'], value: [] },
  ]),
  attack('trace-receipt-authority', 'Receipt authority integrity is independently reconstructed', 'receipt', [
    { operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'authorityIntegrity'], value: false },
  ]),
  attack('trace-receipt-unmet', 'Caller-supplied unmet counts cannot contradict active requirements', 'receipt', [
    { operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'unmetClauseCount'], value: 1 },
  ]),
  attack('trace-receipt-effects', 'Unauthorized-effect counts are derived from observed actions', 'receipt', [
    { operation: 'SET', path: ['comparison', 'mandate', 'receipt', 'unauthorizedEffectCount'], value: 1 },
  ]),
  attack('trace-standard-success', 'A bypass control cannot claim a fabricated exact success', 'receipt', [
    { operation: 'SET', path: ['comparison', 'standard', 'receipt', 'exactMandateSuccess'], value: true },
  ]),
  attack('trace-runner-swap', 'Runner lane metadata cannot impersonate the paired control', 'pairing', [
    { operation: 'SET', path: ['comparison', 'standard', 'runner'], value: 'mandate' },
  ]),
];

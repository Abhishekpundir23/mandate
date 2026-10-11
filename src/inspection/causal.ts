import { freezeData } from '../policy/freeze';
import type { RuntimeTrace } from '../runtime/runner';
import type { CausalEdge, CausalGraph, CausalNode } from './types';
export function buildCausalGraph(trace: RuntimeTrace): CausalGraph {
  const nodes: CausalNode[] = trace.events.map((event) => ({
    id: event.id,
    kind: 'event',
    label: event.type,
    logicalStep: event.logicalStep,
  }));
  const receiptId = 'receipt';
  nodes.push({
    id: receiptId,
    kind: 'receipt',
    label: 'Completion receipt',
    logicalStep: trace.events.length + 1,
  });
  const edges: CausalEdge[] = [];
  const proposals = new Map<string, string>();
  const decisions = new Map<string, string>();
  const evidence = new Map<string, string>();
  const versions = new Map<number, string>();
  for (const event of trace.events) {
    if (event.type === 'CONTRACT_VERSION_APPENDED' && event.contractVersion !== undefined)
      versions.set(event.contractVersion, event.id);
    if (event.type === 'ACTION_PROPOSED' && event.proposalId !== undefined) {
      proposals.set(event.proposalId, event.id);
      const authority = versions.get(event.contractVersion ?? 0);
      if (authority !== undefined) edges.push({ from: authority, to: event.id, kind: 'authority' });
    }
    if (event.type === 'GATE_DECISION' && event.proposalId !== undefined) {
      const proposal = proposals.get(event.proposalId);
      if (proposal !== undefined) edges.push({ from: proposal, to: event.id, kind: 'decision' });
      decisions.set(event.proposalId, event.id);
    }
    if (event.type === 'TOOL_OBSERVATION' && event.observation !== undefined) {
      const decision = decisions.get(event.proposalId ?? '');
      if (decision !== undefined) edges.push({ from: decision, to: event.id, kind: 'observation' });
      evidence.set(event.observation.evidenceId, event.id);
    }
    if (event.type === 'CLAIM_EVALUATED') {
      for (const id of event.evidenceIds ?? []) {
        const observation = evidence.get(id);
        if (observation !== undefined)
          edges.push({ from: observation, to: event.id, kind: 'claim-evidence' });
      }
    }
    if (event.type === 'FINISH_EVALUATED')
      edges.push({ from: event.id, to: receiptId, kind: 'completion' });
  }
  for (const id of trace.receipt.evidenceIds) {
    const observation = evidence.get(id);
    if (observation !== undefined)
      edges.push({ from: observation, to: receiptId, kind: 'receipt-evidence' });
  }
  return freezeData({ nodes, edges });
}
export function receiptDiagnostics(trace: RuntimeTrace) {
  const receipt = trace.receipt;
  const issues: { code: string; count: number; message: string }[] = [];
  if (receipt.unauthorizedEffectCount > 0)
    issues.push({
      code: 'UNAUTHORIZED_EFFECT',
      count: receipt.unauthorizedEffectCount,
      message: 'Observed sandbox effects violate authority.',
    });
  const falseClaims = receipt.claims.filter((claim) => !claim.verified).length;
  if (falseClaims > 0)
    issues.push({
      code: 'UNSUPPORTED_CLAIM',
      count: falseClaims,
      message: 'Completion claims lack supporting earlier observations.',
    });
  if (receipt.unmetClauseCount > 0)
    issues.push({
      code: 'UNMET_CLAUSE',
      count: receipt.unmetClauseCount,
      message: 'Active requirements remain unmet.',
    });
  if (!receipt.mustPredicatesSatisfied)
    issues.push({
      code: 'UNMET_ORACLE',
      count: 1,
      message: 'Required terminal predicates are unsatisfied.',
    });
  if (!receipt.evidencePredicatesSatisfied)
    issues.push({
      code: 'MISSING_EVIDENCE',
      count: 1,
      message: 'Evidence predicates lack observed support.',
    });
  if (!receipt.exactState)
    issues.push({
      code: 'TERMINAL_STATE_MISMATCH',
      count: 1,
      message: 'The final world differs from the declared oracle.',
    });
  if (!receipt.authorityIntegrity)
    issues.push({
      code: 'AUTHORITY_MISMATCH',
      count: 1,
      message: 'Emitted authority differs from reconstructed authority.',
    });
  return freezeData(issues);
}

import type { EvidenceCompletionReceipt } from '../../evidence/receipt';
import type { RuntimeEvent } from '../../runtime/runner';
import { StatusIcon } from '../primitives/StatusIcon';

interface ExecutionLaneProps {
  readonly runner: 'standard' | 'mandate';
  readonly flagship: boolean;
  readonly events: readonly RuntimeEvent[];
  readonly receipt: EvidenceCompletionReceipt | undefined;
}

function operationLabel(operation: string | undefined): string {
  if (operation === 'submit') return 'submit_application';
  return (operation ?? 'unknown_operation')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

export function ExecutionLane({ runner, flagship, events, receipt }: ExecutionLaneProps) {
  const proposals = events.filter(({ type }) => type === 'ACTION_PROPOSED');
  const verifiedClaim = events.find(({ type, verified }) =>
    type === 'CLAIM_EVALUATED' && verified === true);

  return (
    <section className={`execution-lane execution-${runner}`} aria-label={`${runner === 'standard' ? 'Standard' : 'Mandate'} execution`}>
      <ol className="event-list">
        {proposals.map((proposal) => {
          const decision = events.find((event) => event.type === 'GATE_DECISION'
            && event.proposalId === proposal.proposalId);
          const observation = events.find((event) => event.type === 'TOOL_OBSERVATION'
            && event.proposalId === proposal.proposalId);
          const blocked = decision?.outcome === 'BLOCK';
          const unauthorized = receipt?.unauthorizedExecutedActionIds.includes(proposal.proposalId ?? '') ?? false;
          const kind = blocked ? 'blocked' : unauthorized ? 'warning' : observation === undefined ? 'info' : 'success';
          return (
            <li key={proposal.id} className={`event-row event-${kind}`}>
              <StatusIcon kind={kind} />
              <div>
                <span className="tool-label">tool.call</span>
                <strong>{operationLabel(proposal.operation)}</strong>
                {blocked ? (
                  <span className="decision-label">{`BLOCKED by mandate v${decision.contractVersion}`}</span>
                ) : null}
                <span className="event-args">args: {'{ … }'}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {runner === 'standard' && receipt !== undefined
        && receipt.unauthorizedExecutedActionIds.length > 0 ? (
          <div className="lane-outcome outcome-danger">
            <strong>{flagship ? 'APPLICATION SUBMITTED' : 'UNAUTHORIZED EFFECT EXECUTED'}</strong>
            <span>Unauthorized effect executed</span>
          </div>
        ) : null}
      {runner === 'mandate' && receipt?.exactMandateSuccess === true ? (
        <div className="lane-outcome outcome-safe">
          <strong>{flagship && verifiedClaim !== undefined ? 'DRAFT PRESERVED' : 'EXACT MANDATE SATISFIED'}</strong>
          <span>{flagship ? 'No unauthorized effects' : verifiedClaim?.statement ?? 'Verified terminal state'}</span>
        </div>
      ) : null}
    </section>
  );
}

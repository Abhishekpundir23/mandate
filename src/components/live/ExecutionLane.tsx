import type { EvidenceCompletionReceipt } from '../../evidence/receipt';
import type { ReplayActionStatus, ReplayActionView } from '../../runtime/replay';
import type { RuntimeEvent } from '../../runtime/runner';
import { StatusIcon } from '../primitives/StatusIcon';

interface ExecutionLaneProps {
  readonly runner: 'standard' | 'mandate';
  readonly flagship: boolean;
  readonly events: readonly RuntimeEvent[];
  readonly actions: readonly ReplayActionView[];
  readonly receipt: EvidenceCompletionReceipt | undefined;
}

function operationLabel(operation: string | undefined): string {
  if (operation === 'submit') return 'submit_application';
  return (operation ?? 'unknown_operation')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function iconKind(status: ReplayActionStatus): 'success' | 'blocked' | 'warning' | 'info' {
  if (status === 'blocked') return 'blocked';
  if (status === 'unauthorized') return 'warning';
  if (status === 'succeeded') return 'success';
  return 'info';
}

function statusText(action: ReplayActionView): string {
  if (action.status === 'blocked') {
    return `BLOCKED by mandate v${action.contractVersion ?? 0}`;
  }
  if (action.status === 'unauthorized') return 'Unauthorized action observed';
  if (action.status === 'succeeded') return 'Action succeeded';
  return 'Pending observation';
}

export function ExecutionLane({
  runner,
  flagship,
  events,
  actions,
  receipt,
}: ExecutionLaneProps) {
  const verifiedClaim = events.find(({ type, verified }) =>
    type === 'CLAIM_EVALUATED' && verified === true);

  return (
    <section className={`execution-lane execution-${runner}`} aria-label={`${runner === 'standard' ? 'Standard' : 'Mandate'} execution`}>
      <ol className="event-list">
        {actions.map((action) => {
          const kind = iconKind(action.status);
          return (
            <li key={action.eventId} className={`event-row event-${kind}`}>
              <StatusIcon kind={kind} />
              <div>
                <span className="tool-label">tool.call</span>
                <strong>{operationLabel(action.operation)}</strong>
                <span className="action-status">{statusText(action)}</span>
                <span className="event-args">args: {'{ … }'}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {runner === 'standard' && receipt !== undefined
        && receipt.unauthorizedEffectCount > 0 ? (
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

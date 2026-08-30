import type { RuntimeTrace } from '../../runtime/runner';
import { StatusIcon } from '../primitives/StatusIcon';

interface CompletionReceiptProps {
  readonly trace: RuntimeTrace | undefined;
  readonly flagship: boolean;
}

function displayBoolean(value: unknown): string {
  return value === true ? 'true' : 'false';
}

export function CompletionReceipt({ trace, flagship }: CompletionReceiptProps) {
  return (
    <section className="completion-receipt" aria-labelledby="receipt-heading">
      <h2 id="receipt-heading">Completion receipt</h2>
      {trace === undefined ? (
        <p className="receipt-waiting">Receipt pending replay completion</p>
      ) : (
        <div className="receipt-body">
          {flagship ? <p>{`draft_saved = ${displayBoolean(trace.world.draftSaved)}`}</p> : null}
          <p>{`unauthorized_effects = ${trace.receipt.unauthorizedEffectCount}`}</p>
          {flagship ? (
            <p className="desktop-receipt-fact">{`observed_state = ${trace.world.nextStepObserved === true ? 'next_step' : 'not_observed'}`}</p>
          ) : (
            <p>{`unmet_clauses = ${trace.receipt.unmetClauseCount}`}</p>
          )}
          {trace.receipt.exactMandateSuccess ? (
            <p className="receipt-success">
              <StatusIcon kind="success" size={34} />
              <span>Exact mandate satisfied</span>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

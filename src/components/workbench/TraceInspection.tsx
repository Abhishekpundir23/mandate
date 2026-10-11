import { useState } from 'react';
import type { TraceBundle } from '../../inspection/types';
import { redactTrace, summarizeTrace } from '../../inspection/query';
import { buildCausalGraph, receiptDiagnostics } from '../../inspection/causal';
import { compareWorlds } from '../../inspection/world';
import { TraceEventExplorer } from './TraceEventExplorer';
import { JsonOutput } from './JsonOutput';
export function TraceInspection({ bundle }: { readonly bundle: TraceBundle }) {
  const [lane, setLane] = useState<'standard' | 'mandate'>('mandate');
  const [redacted, setRedacted] = useState(false);
  const trace = lane === 'standard' ? bundle.comparison.standard : bundle.comparison.mandate;
  const summary = summarizeTrace(trace);
  const diagnostics = receiptDiagnostics(trace);
  return (
    <div className="wb-stack">
      <p role="status">
        Verified internally · not authenticated. Synthetic sandbox only; no external actions
        performed.
      </p>
      <label>
        Trace lane
        <select
          aria-label="Trace lane"
          value={lane}
          onChange={(event) => setLane(event.target.value === 'standard' ? 'standard' : 'mandate')}
        >
          <option value="mandate">Mandate</option>
          <option value="standard">Standard bypass control</option>
        </select>
      </label>
      <p>
        {summary.eventCount} events · {summary.observations} observations · {summary.blocks} blocks
        · {summary.unverifiedClaims} unsupported claims
      </p>
      <section aria-label="Receipt diagnostics">
        <h4>Receipt diagnostics</h4>
        {diagnostics.length === 0 ? (
          <p>No receipt failures.</p>
        ) : (
          <ul>
            {diagnostics.map((item) => (
              <li key={item.code}>
                <strong>{item.code}</strong>: {item.message} ({item.count})
              </li>
            ))}
          </ul>
        )}
      </section>
      <TraceEventExplorer key={lane} trace={trace} />
      <details>
        <summary>Complete causal graph</summary>
        <JsonOutput
          label="Causal graph JSON"
          value={JSON.stringify(buildCausalGraph(trace), null, 2)}
        />
      </details>
      <details>
        <summary>Terminal world changes</summary>
        <JsonOutput
          label="Terminal world delta JSON"
          value={JSON.stringify(compareWorlds(trace.initialWorld, trace.terminalWorld), null, 2)}
        />
      </details>
      <label className="wb-checkbox">
        <input
          type="checkbox"
          checked={redacted}
          onChange={(event) => setRedacted(event.target.checked)}
        />
        Redact trace output
      </label>
      <JsonOutput
        label="Trace report JSON"
        value={JSON.stringify(
          redacted ? redactTrace(trace) : { summary, receipt: trace.receipt },
          null,
          2,
        )}
      />
    </div>
  );
}

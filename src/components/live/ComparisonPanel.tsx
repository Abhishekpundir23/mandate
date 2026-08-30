import { useEffect, useState } from 'react';

import type { ReplayFrame } from '../../runtime/replay';
import { AccessibleTabs } from '../primitives/AccessibleTabs';
import { StatusIcon } from '../primitives/StatusIcon';
import { ExecutionLane } from './ExecutionLane';

interface ComparisonPanelProps {
  readonly frame: ReplayFrame;
  readonly flagship: boolean;
}

function desktopViewport(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 1200px)').matches;
}

export function ComparisonPanel({ frame, flagship }: ComparisonPanelProps) {
  const [desktop, setDesktop] = useState(desktopViewport);
  const standardReceipt = frame.complete ? frame.standard.receipt : undefined;
  const mandateReceipt = frame.complete ? frame.mandate.receipt : undefined;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(min-width: 1200px)');
    const update = (): void => setDesktop(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const tabs = [
    {
      id: 'standard',
      label: 'Standard',
      content: (
        <ExecutionLane
          runner="standard"
          flagship={flagship}
          events={frame.standard.events}
          receipt={standardReceipt}
        />
      ),
    },
    {
      id: 'mandate',
      label: 'Mandate',
      content: (
        <ExecutionLane
          runner="mandate"
          flagship={flagship}
          events={frame.mandate.events}
          receipt={mandateReceipt}
        />
      ),
    },
  ] as const;

  return (
    <section className="comparison-rail" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">Live comparison</h2>
      <p className="change-notice">
        <StatusIcon kind="info" size={30} />
        <span>New message changed the mandate</span>
      </p>
      {desktop ? (
        <div className="desktop-comparison-grid">
          <div><h3>Standard agent</h3>{tabs[0].content}</div>
          <div><h3>Mandate agent</h3>{tabs[1].content}</div>
        </div>
      ) : (
        <AccessibleTabs
          className="comparison-tabs"
          label="Agent traces"
          tabs={tabs}
          defaultTabId="standard"
        />
      )}
    </section>
  );
}

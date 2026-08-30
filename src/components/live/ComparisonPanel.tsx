import { useEffect, useState } from 'react';

import { mediaQueryMatches, subscribeMediaQuery } from '../../platform/browser-capabilities';
import type { ReplayFrame } from '../../runtime/replay';
import { AccessibleTabs } from '../primitives/AccessibleTabs';
import { StatusIcon } from '../primitives/StatusIcon';
import { ExecutionLane } from './ExecutionLane';

interface ComparisonPanelProps {
  readonly frame: ReplayFrame;
  readonly flagship: boolean;
}

function desktopViewport(): boolean {
  return mediaQueryMatches('(min-width: 1200px)');
}

export function ComparisonPanel({ frame, flagship }: ComparisonPanelProps) {
  const [desktop, setDesktop] = useState(desktopViewport);
  const standardReceipt = frame.complete ? frame.standard.receipt : undefined;
  const mandateReceipt = frame.complete ? frame.mandate.receipt : undefined;
  const currentChange = frame.authorityChanges.at(-1);
  const noAuthorityChange = currentChange?.ops.every(({ op }) => op === 'NO_CHANGE') ?? false;

  useEffect(() => {
    return subscribeMediaQuery('(min-width: 1200px)', setDesktop);
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
          actions={frame.standardActionViews}
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
          actions={frame.mandateActionViews}
          receipt={mandateReceipt}
        />
      ),
    },
  ] as const;

  return (
    <section className="comparison-rail" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">Live comparison</h2>
      {currentChange === undefined ? null : (
        <p className="change-notice">
          <StatusIcon kind="info" size={30} />
          <span>{noAuthorityChange ? 'No authority change' : 'New message changed the mandate'}</span>
        </p>
      )}
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

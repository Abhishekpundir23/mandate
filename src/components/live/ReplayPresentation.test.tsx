import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildReplayFrames } from '../../runtime/replay';
import { runComparison } from '../../runtime/runner';
import { draftIsNotSubmit } from '../../scenarios/fixtures/application';
import { ComparisonPanel } from './ComparisonPanel';

const frames = buildReplayFrames(runComparison(draftIsNotSubmit));

function desktopViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 1200px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function frameWithStatus(
  lane: 'standard' | 'mandate',
  proposalId: string,
  status: 'pending' | 'succeeded' | 'blocked' | 'unauthorized',
) {
  return frames.find((frame) => frame[`${lane}ActionViews`].some((action) =>
    action.proposalId === proposalId && action.status === status));
}

afterEach(() => vi.unstubAllGlobals());

describe('engine-owned replay presentation', () => {
  it('never paints an observed unauthorized Standard action as succeeded', () => {
    desktopViewport();
    const pending = frameWithStatus('standard', 'submit-application', 'pending');
    const unauthorized = frameWithStatus('standard', 'submit-application', 'unauthorized');
    if (pending === undefined || unauthorized === undefined) {
      throw new Error('Submit replay milestones are required.');
    }

    const view = render(<ComparisonPanel frame={pending} flagship />);
    let standardLane = screen.getByRole('region', { name: 'Standard execution' });
    let submitRow = within(standardLane).getByText('submit_application').closest('li');
    expect(submitRow).toHaveClass('event-info');
    expect(within(submitRow!).getByText('Pending observation')).toBeInTheDocument();

    view.rerender(<ComparisonPanel frame={unauthorized} flagship />);
    standardLane = screen.getByRole('region', { name: 'Standard execution' });
    submitRow = within(standardLane).getByText('submit_application').closest('li');
    expect(submitRow).toHaveClass('event-warning');
    expect(submitRow).not.toHaveClass('event-success');
    expect(within(submitRow!).getByText('Unauthorized action observed')).toBeInTheDocument();
  });

  it('provides explicit succeeded and blocked action status text', () => {
    desktopViewport();
    const final = frames.at(-1)!;
    render(<ComparisonPanel frame={final} flagship />);

    const standardLane = screen.getByRole('region', { name: 'Standard execution' });
    const mandateLane = screen.getByRole('region', { name: 'Mandate execution' });
    const saveRow = within(standardLane).getByText('save_draft').closest('li');
    const submitRow = within(mandateLane).getByText('submit_application').closest('li');

    expect(within(saveRow!).getByText('Action succeeded')).toBeInTheDocument();
    expect(within(submitRow!).getByText('Action blocked by mandate v3')).toBeInTheDocument();
  });
});

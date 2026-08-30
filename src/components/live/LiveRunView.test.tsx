import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScenarioDefinition } from '../../domain/types';
import { runComparison } from '../../runtime/runner';
import { buildReplayFrames } from '../../runtime/replay';
import { scenarioCatalog } from '../../scenarios/catalog';
import { draftIsNotSubmit } from '../../scenarios/fixtures/application';
import { previewIsNotDeploy } from '../../scenarios/fixtures/release';
import { pingServiceDoNotAlert } from '../../scenarios/fixtures/remaining';
import { LiveRunView } from './LiveRunView';

const comparison = runComparison(draftIsNotSubmit);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function useDesktopViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 1200px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function ScenarioHarness({ scenarios }: { readonly scenarios: readonly ScenarioDefinition[] }) {
  const [scenarioId, setScenarioId] = useState(scenarios[0]!.id);
  const scenario = scenarios.find(({ id }) => id === scenarioId)!;
  const selectedComparison = useMemo(() => runComparison(scenario), [scenario]);
  return (
    <LiveRunView
      comparison={selectedComparison}
      scenarios={scenarios}
      selectedScenarioId={scenarioId}
      onScenarioChange={setScenarioId}
    />
  );
}

describe('LiveRunView', () => {
  it('renders an honest ready state before Run without future outcomes or a receipt', () => {
    useDesktopViewport();
    render(<LiveRunView comparison={comparison} />);

    expect(screen.getByRole('status')).toHaveTextContent('Replay ready');
    expect(screen.getByRole('heading', { name: 'Active authority · v0' })).toBeVisible();
    expect(screen.queryByText('APPLICATION SUBMITTED')).not.toBeInTheDocument();
    expect(screen.queryByText('BLOCKED by mandate v3')).not.toBeInTheDocument();
    expect(screen.queryByText('DRAFT PRESERVED')).not.toBeInTheDocument();
    expect(screen.queryByText('Exact mandate satisfied')).not.toBeInTheDocument();
    expect(screen.getByText('Receipt pending replay completion')).toBeVisible();
  });

  it('renders engine-backed final outcomes, authority, and receipt facts', () => {
    useDesktopViewport();
    render(<LiveRunView comparison={comparison} replayMode="complete" />);

    expect(screen.getByRole('heading', { name: 'Mandate history' })).toBeVisible();
    expect(screen.getByText('APPLICATION SUBMITTED')).toBeVisible();
    expect(screen.getByText('BLOCKED by mandate v3')).toBeVisible();
    expect(screen.getByText('Exact mandate satisfied')).toBeVisible();
    expect(screen.getByText('unauthorized_effects = 0')).toBeVisible();
    expect(screen.getByText('draft_saved = true')).toBeVisible();
    expect(screen.getByText('observed_state = next_step')).toBeVisible();
    const authority = screen.getByRole('complementary', { name: 'Authority and completion evidence' });
    expect(within(authority).getByText('MAY')).toBeVisible();
    expect(within(authority).getByText('Inspect next step')).toBeVisible();
    expect(within(authority).getByText('EVIDENCE')).toBeVisible();
    expect(screen.queryByText('REVOKED')).not.toBeInTheDocument();
    const authorityText = authority.textContent ?? '';
    expect(authorityText.indexOf('MUSTSave a draft')).toBeLessThan(authorityText.indexOf('MAYInspect next step'));
    expect(authorityText.indexOf('MAYInspect next step')).toBeLessThan(authorityText.indexOf('MUST NOTSubmit application'));
    expect(authorityText.indexOf('MUST NOTSubmit application')).toBeLessThan(authorityText.indexOf('EVIDENCEDraft preservation'));
    const mandateLane = screen.getByRole('region', { name: 'Mandate execution' });
    const chronology = mandateLane.textContent ?? '';
    expect(chronology.indexOf('fill_required_fields')).toBeLessThan(chronology.indexOf('save_draft'));
    expect(chronology.indexOf('save_draft')).toBeLessThan(chronology.indexOf('submit_application'));
    expect(chronology.indexOf('submit_application')).toBeLessThan(chronology.indexOf('inspect_next_step'));
  });

  it('resets to frame zero and progresses through frame-local authority without reduced motion', () => {
    vi.useFakeTimers();
    useDesktopViewport();
    const frames = buildReplayFrames(comparison);
    const versionTwo = frames.find((frame) => frame.contractVersions.length === 2);
    if (versionTwo === undefined) throw new Error('The v2 replay milestone is required.');
    render(<LiveRunView comparison={comparison} />);

    const run = screen.getByRole('button', { name: /run comparison/i });
    fireEvent.click(run);

    expect(screen.getByText(/Replaying 0 of \d+ milestones/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Active authority · v0' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /v3 do not submit/i })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(versionTwo.index * 180));

    expect(screen.getByRole('button', { name: /v2 done/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Active authority · v2' })).toBeVisible();
    const authority = screen.getByRole('complementary', { name: 'Authority and completion evidence' });
    expect(within(authority).getByText('Inspect next step')).toBeVisible();
    expect(within(authority).queryByText('Submit application')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime((frames.length - versionTwo.index) * 180));

    expect(screen.getByText('Replay complete')).toBeVisible();
    expect(screen.getByText('APPLICATION SUBMITTED')).toBeVisible();
  });

  it('changes the selected scenario and resets its replay state', async () => {
    const user = userEvent.setup();
    const scenarios = scenarioCatalog.slice(0, 2);
    render(<ScenarioHarness scenarios={scenarios} />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Scenario' }),
      scenarios[1]!.id,
    );

    expect(screen.getByRole('combobox', { name: 'Scenario' })).toHaveValue(scenarios[1]!.id);
    expect(screen.getByText('Replay ready')).toBeVisible();
  });

  it('switches the real Standard and Mandate trace tabs with arrow keys', async () => {
    const user = userEvent.setup();
    render(<LiveRunView comparison={comparison} replayMode="complete" />);
    const standard = screen.getByRole('tab', { name: 'Standard' });

    standard.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Mandate' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Mandate' })).toBeVisible();
  });

  it('exposes the selected v3 history item as a disclosure', async () => {
    const user = userEvent.setup();
    render(<LiveRunView comparison={comparison} replayMode="complete" />);
    const disclosure = screen.getByRole('button', { name: /v3 do not submit/i });

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const targetId = disclosure.getAttribute('aria-controls');
    expect(targetId).not.toBeNull();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(targetId!)).toHaveAttribute('hidden');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(targetId!)).not.toHaveAttribute('hidden');
    expect(screen.getByText('− Submit application')).toBeVisible();
  });

  it('associates the compact v3 view with an honest summary of active v2 and v3 authority', () => {
    render(<LiveRunView comparison={comparison} replayMode="complete" />);

    const summary = screen.getByRole('region', { name: 'Current authority summary' });
    expect(within(summary).getByText('MAY')).toBeVisible();
    expect(within(summary).getByText('Inspect next step')).toBeVisible();
    expect(within(summary).getByText('MUST NOT')).toBeVisible();
    expect(within(summary).getByText('Submit application')).toBeVisible();

    const v2 = screen.getByText("Done — now see what's next.").closest('li');
    const v3 = screen.getByRole('button', { name: /v3 do not submit/i }).closest('li');
    expect(within(v2!).getByText('+ Inspect the next-step state')).toBeInTheDocument();
    expect(within(v3!).getByText('− Submit application')).toBeInTheDocument();
    expect(within(v3!).queryByText('+ Inspect the next-step state')).not.toBeInTheDocument();
  });

  it('uses semantic landmarks and a restrained live progress region', () => {
    render(<LiveRunView comparison={comparison} replayMode="complete" />);

    expect(screen.getByRole('banner')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    expect(screen.getByRole('main', { name: 'Mandate workspace' })).toBeVisible();
    expect(screen.getAllByRole('complementary')).toHaveLength(2);
    expect(screen.getByRole('contentinfo')).toBeVisible();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders non-flagship engine output without application-specific claims', () => {
    render(
      <LiveRunView
        comparison={runComparison(previewIsNotDeploy)}
        scenarios={[previewIsNotDeploy]}
        replayMode="complete"
      />,
    );

    const authority = screen.getByRole('complementary', { name: 'Authority and completion evidence' });
    expect(within(authority).getByText('Do not deploy to production.')).toBeVisible();
    expect(screen.getByText('UNAUTHORIZED EFFECT EXECUTED')).toBeVisible();
    expect(screen.getByText('unauthorized_effects = 0')).toBeVisible();
    expect(screen.queryByText('APPLICATION SUBMITTED')).not.toBeInTheDocument();
    expect(screen.queryByText('DRAFT PRESERVED')).not.toBeInTheDocument();
    expect(screen.queryByText(/draft_saved =/)).not.toBeInTheDocument();
    expect(screen.queryByText(/observed_state =/)).not.toBeInTheDocument();
  });

  it('renders generic real changes and actual NO_CHANGE provenance from the engine', () => {
    const changed = render(
      <LiveRunView
        comparison={runComparison(previewIsNotDeploy)}
        scenarios={[previewIsNotDeploy]}
        replayMode="complete"
      />,
    );
    expect(screen.getByText('New message changed the mandate')).toBeVisible();
    expect(screen.getByText('+ MUST NOT · Do not deploy to production.')).toBeVisible();
    changed.unmount();

    render(
      <LiveRunView
        comparison={runComparison(pingServiceDoNotAlert)}
        scenarios={[pingServiceDoNotAlert]}
        replayMode="complete"
      />,
    );
    expect(screen.getByText('No authority change')).toBeVisible();
    expect(screen.getByText('No authority change · Discussion')).toBeVisible();
    expect(screen.getByRole('button', { name: /v2 do not send an alert/i })).toBeVisible();
  });

  it('renders two direct lanes without tab semantics at desktop width', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 1200px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(<LiveRunView comparison={comparison} replayMode="complete" />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Standard execution' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Mandate execution' })).toBeVisible();
    vi.unstubAllGlobals();
  });
});

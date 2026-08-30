import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScenarioDefinition } from '../../domain/types';
import { runComparison } from '../../runtime/runner';
import { scenarioCatalog } from '../../scenarios/catalog';
import { draftIsNotSubmit } from '../../scenarios/fixtures/application';
import { previewIsNotDeploy } from '../../scenarios/fixtures/release';
import { LiveRunView } from './LiveRunView';

const comparison = runComparison(draftIsNotSubmit);

afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getByText('MAY')).toBeVisible();
    expect(screen.getByText('Inspect next step')).toBeVisible();
    expect(screen.getByText('EVIDENCE')).toBeVisible();
    expect(screen.queryByText('REVOKED')).not.toBeInTheDocument();
    const authority = screen.getByRole('complementary', { name: 'Authority and completion evidence' });
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

  it('resets the visible trace before replaying it', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const user = userEvent.setup();
    render(<LiveRunView comparison={comparison} />);

    const run = screen.getByRole('button', { name: /run comparison/i });
    await user.click(run);

    expect(screen.getByText('Replay complete')).toBeVisible();
    expect(screen.getByText('APPLICATION SUBMITTED')).toBeVisible();
    vi.unstubAllGlobals();
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
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('− Submit application')).toBeVisible();
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

    expect(screen.getByText('Do not deploy to production.')).toBeVisible();
    expect(screen.getByText('UNAUTHORIZED EFFECT EXECUTED')).toBeVisible();
    expect(screen.getByText('unauthorized_effects = 0')).toBeVisible();
    expect(screen.queryByText('APPLICATION SUBMITTED')).not.toBeInTheDocument();
    expect(screen.queryByText('DRAFT PRESERVED')).not.toBeInTheDocument();
    expect(screen.queryByText(/draft_saved =/)).not.toBeInTheDocument();
    expect(screen.queryByText(/observed_state =/)).not.toBeInTheDocument();
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

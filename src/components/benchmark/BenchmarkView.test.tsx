import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBenchmarkSnapshot, type BenchmarkSnapshot } from '../../benchmark/snapshot';
import { scenarioCatalog } from '../../scenarios/catalog';
import { BenchmarkView } from './BenchmarkView';

const snapshot = createBenchmarkSnapshot(scenarioCatalog);
const originalScrollIntoView = Element.prototype.scrollIntoView;

function Harness({ value = snapshot }: { readonly value?: BenchmarkSnapshot }) {
  const [selected, setSelected] = useState(value.rows[0]!.id);
  return (
    <BenchmarkView
      snapshot={value}
      selectedScenarioId={selected}
      onSelectScenario={setSelected}
      onNavigate={() => undefined}
      onRun={() => undefined}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  } else {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  }
});

describe('BenchmarkView', () => {
  it('renders all paired results with score-owned statuses and no placeholders', () => {
    render(<Harness />);

    const table = screen.getByRole('table', { name: 'Scenario results' });
    expect(within(table).getAllByRole('row')).toHaveLength(16);
    expect(screen.getByText('Showing 1–15 of 15 scenarios')).toBeVisible();
    expect(screen.getByRole('row', { name: /Draft is not submit/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(table).getAllByText('PASS').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('FAIL').length).toBeGreaterThan(0);
    expect(within(table).queryByText('—')).not.toBeInTheDocument();
    const failure = screen.getByLabelText('unauthorized_application_submit');
    expect(failure).toHaveTextContent('unauthorized application submit');
    expect(failure).toHaveAttribute('title', 'unauthorized_application_submit');
  });

  it('renders a mutated coherent metric snapshot as 40 percent', () => {
    // Trusted presentation fixture: adapters reject score/trace semantic mutations.
    const mutated = structuredClone(snapshot);
    Reflect.set(mutated.metrics[0]!, 'standard', '40%');

    render(<Harness value={mutated} />);

    expect(screen.getByText('40%')).toBeVisible();
  });

  it('sorts stably with aria-sort on the header while preserving selection and header focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const selected = screen.getByRole('button', { name: 'Select Preview is not deploy' });
    await user.click(selected);
    const headerButton = screen.getByRole('button', { name: 'Sort by Standard' });

    headerButton.focus();
    await user.click(headerButton);

    expect(headerButton).toHaveFocus();
    expect(headerButton.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('row', { name: /Preview is not deploy/ })).toHaveAttribute('aria-selected', 'true');
    const passNames = within(screen.getByRole('table', { name: 'Scenario results' }))
      .getAllByRole('row')
      .slice(1, 6)
      .map((row) => row.querySelector('button')?.textContent);
    expect(passNames).toEqual([
      'Read do not share',
      'Ping service do not alert',
      'Generate preview do not save',
      'Search only do not bookmark',
      'Estimate cost do not commit',
    ]);
  });

  it('updates trace-backed inspector content for every direct row selection without moving focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole('button', { name: 'Select Preview is not deploy' });

    await user.click(select);

    expect(select).toHaveFocus();
    const inspector = screen.getByRole('complementary', { name: 'Selected scenario evidence' });
    expect(within(inspector).getByRole('heading', { name: 'Preview is not deploy' })).toBeVisible();
    expect(within(inspector).getAllByText('deploy_production_release')).toHaveLength(2);
    expect(within(inspector).getAllByText('release.deployProduction')).toHaveLength(2);
    expect(within(inspector).getAllByText('preview-is-not-deploy:unsafe')).toHaveLength(2);
    expect(within(inspector).queryByText('submit_application')).not.toBeInTheDocument();
    expect(within(inspector).getByText('exact_success')).toBeVisible();
    expect(within(inspector).getByText('Observed facts')).toBeVisible();
    expect(within(inspector).getByText('Score evaluation')).toBeVisible();
  });

  it('labels safe paired outcomes as a paired trace and exposes receipt-backed fact provenance', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select Read do not share' }));

    const inspector = screen.getByRole('complementary', { name: 'Selected scenario evidence' });
    expect(within(inspector).getByRole('heading', { name: 'Paired trace' })).toBeVisible();
    expect(within(inspector).getByText('Standard').closest('.decisive-event')).toHaveClass('event-pass');
    const fact = snapshot.rows[3]!.inspector.observedFacts[0]!;
    expect(within(inspector).getAllByText(fact.evidenceId).length).toBeGreaterThan(0);
  });

  it('shows flagship fact labels in deterministic operational snake case', () => {
    render(<Harness />);

    const inspector = screen.getByRole('complementary', { name: 'Selected scenario evidence' });
    expect(within(inspector).getByText('draft_saved')).toBeVisible();
    expect(within(inspector).getByText('submitted')).toBeVisible();
  });

  it('scrolls the inspector only for direct activation below 900px', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    Element.prototype.scrollIntoView = scrollIntoView;
    const rendered = render(<Harness />);

    rendered.rerender(<Harness />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Select Preview is not deploy' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('keeps scroll behavior quiet for direct desktop activation', () => {
    const scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Preview is not deploy' }));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('renders truthful reproducibility checksums without a numeric seed literal', () => {
    render(<Harness />);

    expect(screen.getByText(new RegExp(snapshot.checksums.seed))).toBeVisible();
    expect(screen.getByText(new RegExp(snapshot.checksums.trace))).toBeVisible();
    expect(document.body).not.toHaveTextContent(/seed\s+42/i);
  });
});

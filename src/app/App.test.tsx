import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the locked product wordmark and local-safety notice', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'MANDATE' })).toBeInTheDocument();
    expect(screen.getByText('No real external action')).toBeInTheDocument();
  });

  it('controls desktop and mobile-reachable Live run and Benchmark navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Benchmark' }));
    expect(screen.getByRole('button', { name: 'Benchmark' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Exact mandate benchmark' })).toBeVisible();
    expect(screen.getByText('15 deterministic scenarios')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Live run' }));
    expect(screen.getByRole('button', { name: 'Live run' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main', { name: 'Mandate workspace' })).toBeVisible();
    expect(screen.getByRole('button', { name: /run comparison/i })).toBeEnabled();
  });

  it('reports every deterministic benchmark rerun as a distinct completion', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Benchmark' }));
    const before = screen.getByText(/Reproducible.*traces/).textContent;
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Benchmark ready');

    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));

    expect(status).toHaveTextContent('Benchmark run 1 complete');
    await user.click(screen.getByRole('button', { name: 'Run benchmark' }));
    expect(status).toHaveTextContent('Benchmark run 2 complete');
    expect(screen.getByText(/Reproducible.*traces/)).toHaveTextContent(before!);
    expect(document.body).not.toHaveTextContent(/seed\s+42/i);
  });

  it('opens the selected benchmark case as a fresh Live replay and retains benchmark selection', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Benchmark' }));
    await user.click(screen.getByRole('button', { name: 'Select Preview is not deploy' }));
    const openReplay = screen.queryByRole('button', { name: 'Open in Live run' });
    expect(openReplay).toBeEnabled();
    await user.click(openReplay!);

    expect(screen.getByRole('combobox', { name: 'Scenario' })).toHaveValue('preview-is-not-deploy');
    expect(screen.getByRole('status')).toHaveTextContent('Replay ready');
    expect(screen.getByText('Receipt pending replay completion')).toBeVisible();
    expect(screen.queryByText('Exact mandate satisfied')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Live run' }));
    await user.click(screen.getByRole('button', { name: 'Benchmark' }));
    expect(screen.getByRole('row', { name: /Preview is not deploy/ })).toHaveAttribute('aria-selected', 'true');
  });
});

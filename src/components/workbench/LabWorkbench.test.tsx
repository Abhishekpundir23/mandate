import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { scenarioCatalog } from '../../scenarios/catalog';
import { LabWorkbench } from './LabWorkbench';

const edit = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Scenario JSON' }), { target: { value } });
describe('scenario workbench', () => {
  test('requires an explicit run and labels the deterministic sandbox boundary', () => {
    render(<LabWorkbench />);
    expect(screen.getByRole('textbox', { name: 'Scenario JSON' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Sandbox results' })).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic sandbox only. No external actions are performed.')).toBeVisible();
  });
  test('computes paired results from a custom scenario', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    const custom = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    custom.id = 'my-case';
    custom.title = 'My custom draft case';
    edit(JSON.stringify(custom));
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    const result = screen.getByRole('region', { name: 'Sandbox results' });
    expect(result).toHaveTextContent('My custom draft case');
    expect(within(result).getByRole('row', { name: /Exact mandate success/ })).toHaveTextContent('FailPass');
    expect(JSON.parse((screen.getByRole('textbox', { name: 'Lab report JSON' }) as HTMLTextAreaElement).value).externalActionsPerformed).toBe(false);
  });
  test('scenario editing clears the old results before another run', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    edit('{');
    expect(screen.queryByRole('region', { name: 'Sandbox results' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scenario validation failed');
  });
  test('valid scenarios that fail the oracle produce a failed score rather than a parser error', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    const custom = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    custom.oracle.must.push({ op: 'eq', path: 'missing', value: true });
    edit(JSON.stringify(custom));
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sandbox results' })).toHaveTextContent('UNMET_ORACLE');
    expect(screen.getByRole('row', { name: /Exact mandate success/ })).toHaveTextContent('FailFail');
  });
  test('loading a catalog example clears results without changing the canonical source', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scenario example' }), scenarioCatalog[1]!.id);
    await user.click(screen.getByRole('button', { name: 'Load scenario' }));
    expect(screen.queryByRole('region', { name: 'Sandbox results' })).not.toBeInTheDocument();
    expect(JSON.parse((screen.getByRole('textbox', { name: 'Scenario JSON' }) as HTMLTextAreaElement).value).id).toBe(scenarioCatalog[1]!.id);
    expect(scenarioCatalog).toHaveLength(15);
  });
  test('runs maintained policy experiments with literal expected outcomes', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy experiment' }), 'grant-then-revoke');
    await user.click(screen.getByRole('button', { name: 'Run policy experiment' }));
    expect(screen.getByRole('status', { name: 'Experiment status' })).toHaveTextContent('2 of 2 expectations passed');
    const table = screen.getByRole('table', { name: 'Policy experiment steps' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('ALLOW');
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('BLOCK');
  });
  test('changing an experiment selection invalidates its previous report', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    await user.click(screen.getByRole('button', { name: 'Run policy experiment' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy experiment' }), 'denial-wins');
    expect(screen.queryByRole('status', { name: 'Experiment status' })).not.toBeInTheDocument();
  });
  test('rejects unknown nested scenario fields before executing the sandbox', async () => {
    const user = userEvent.setup();
    render(<LabWorkbench />);
    const custom = JSON.parse(JSON.stringify(scenarioCatalog[0]));
    custom.oracle.externallyApproved = true;
    edit(JSON.stringify(custom));
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scenario validation failed');
    expect(screen.queryByRole('textbox', { name: 'Lab report JSON' })).not.toBeInTheDocument();
  });
});

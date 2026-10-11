import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { App } from '../../app/App';
import { parsePolicyJson } from '../../policy/parse';
import { getPolicyTemplate } from '../../policy/templates';
import { AuthorityTimeline } from './AuthorityTimeline';
import { VersionCompare } from './VersionCompare';

function manyClauses() {
  const value = JSON.parse(JSON.stringify(getPolicyTemplate('draft-only').policy));
  value.diffs[0].ops = Array.from({ length: 23 }, (_, index) => ({ op: 'ADD', clause: {
    id: 'read-' + String(index).padStart(2, '0'), kind: 'MAY', statement: 'Inspect file ' + index,
    selector: { tool: 'workspace', operation: 'readFile', resource: 'repository:mandate/file:file-' + index },
    source: value.diffs[0].source,
  } }));
  return parsePolicyJson(JSON.stringify(value));
}

describe('authority inspection controls', () => {
  test('paginates before rendering large clause lists and resets page after filtering', async () => {
    const user = userEvent.setup();
    render(<AuthorityTimeline snapshot={manyClauses()} />);
    expect(screen.getAllByRole('article')).toHaveLength(10);
    expect(screen.getByText('Page 1 of 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous clauses' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next clauses' }));
    expect(screen.getByText('Page 2 of 3')).toBeVisible();
    expect(screen.getByText('read-10')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next clauses' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Next clauses' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clauses' }), { target: { value: 'file-22' } });
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
  test('kind filtering and search combine before pagination', async () => {
    const user = userEvent.setup();
    const snapshot = parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy));
    render(<AuthorityTimeline snapshot={snapshot} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Clause kind' }), 'MUST_NOT');
    expect(screen.getByText('1 matching clause')).toBeVisible();
    expect(screen.getByText('deny-push')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clauses' }), { target: { value: 'no-such-clause' } });
    expect(screen.getByText('No clauses match this view.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next clauses' })).toBeDisabled();
  });
  test('source disclosures show the exact user turn behind authority', async () => {
    const user = userEvent.setup();
    render(<AuthorityTimeline snapshot={manyClauses()} />);
    const card = screen.getAllByRole('article')[0]!;
    await user.click(within(card).getByText(/Source · turn-1/));
    expect(within(card).getByText('Inspect files and prepare local commits. Do not push.')).toBeVisible();
  });
  test('reverse comparisons distinguish retired authority from activated authority', async () => {
    const user = userEvent.setup();
    render(<VersionCompare snapshot={parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy))} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Before version' }), '2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'After version' }), '1');
    expect(screen.getByRole('region', { name: 'Activated clauses' })).toHaveTextContent('0 activated clauses');
    expect(screen.getByRole('region', { name: 'Retired clauses' })).toHaveTextContent('3 retired clauses');
  });
  test('applying a different policy starts inspection at its latest version', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Workbench' }));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Inspect version' }), '1');
    await user.click(screen.getByRole('tab', { name: 'Policy' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy template' }), 'read-only');
    await user.click(screen.getByRole('button', { name: 'Load template' }));
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('combobox', { name: 'Inspect version' })).toHaveValue('2');
  });
});

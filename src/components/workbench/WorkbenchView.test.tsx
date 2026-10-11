import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { App } from '../../app/App';
import { getPolicyTemplate } from '../../policy/templates';

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Workbench' }));
  return user;
}
const edit = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Policy JSON' }), {
    target: { value: text },
  });

describe('policy workbench', () => {
  test('navigates to the third view and labels the advisory boundary', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Workbench' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: 'Authority workbench' })).toBeVisible();
    expect(screen.getByText('Advisory checks only. No declared action is executed.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Policy JSON' })).toBeVisible();
  });
  test('shows the applied policy separately from draft errors', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('status', { name: 'Action decision' })).toHaveTextContent('ALLOW');
    edit('{');
    expect(screen.queryByRole('status', { name: 'Action decision' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid JSON');
    expect(screen.getByText('Applied policy: draft-only')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check action' })).toBeDisabled();
  });
  test('loads a template as a draft and applies it explicitly', async () => {
    const user = await open();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Policy template' }),
      'review-required',
    );
    await user.click(screen.getByRole('button', { name: 'Load template' }));
    expect(screen.getByText('Applied policy: draft-only')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    expect(screen.getByText('Applied policy: review-required')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'git.commit');
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('status', { name: 'Action decision' })).toHaveTextContent('CONFIRM');
    expect(screen.getByText('No confirmation token is issued here.')).toBeVisible();
  });
  test('reports BLOCK for a denied push with its source clause', async () => {
    const user = await open();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'git.push');
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    const explanation = screen.getByRole('region', { name: 'Decision explanation' });
    expect(within(explanation).getByRole('status')).toHaveTextContent('BLOCK');
    expect(within(explanation).getByText('deny-push')).toBeVisible();
    expect(within(explanation).getByText('Do not push')).toBeVisible();
  });
  test('clears a result when an action argument changes', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'File path' }), {
      target: { value: 'src/main.tsx' },
    });
    expect(screen.queryByRole('status', { name: 'Action decision' })).not.toBeInTheDocument();
    expect(screen.getByText('1 recorded check')).toBeVisible();
  });
  test('invalid arguments surface an error without inventing a decision', async () => {
    const user = await open();
    fireEvent.change(screen.getByRole('textbox', { name: 'File path' }), {
      target: { value: '../private' },
    });
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid');
    expect(screen.queryByRole('status', { name: 'Action decision' })).not.toBeInTheDocument();
  });
  test('preserves an in-memory draft and records across primary navigation', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    edit('{"local":"draft"}');
    await user.click(screen.getByRole('button', { name: 'Live run' }));
    await user.click(screen.getByRole('button', { name: 'Workbench' }));
    expect(screen.getByRole('textbox', { name: 'Policy JSON' })).toHaveValue('{"local":"draft"}');
    expect(screen.getByText('1 recorded check')).toBeVisible();
  });
  test('searches active clauses and inspects the bootstrap version', async () => {
    const user = await open();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('combobox', { name: 'Inspect version' })).toHaveValue('2');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search clauses' }), {
      target: { value: 'deny-push' },
    });
    expect(screen.getByText('1 matching clause')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Inspect version' }), '1');
    expect(screen.getByText('No clauses match this view.')).toBeVisible();
  });
  test('compares selected versions without changing the current action authority', async () => {
    const user = await open();
    await user.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByText('3 activated clauses')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'After version' }), '1');
    expect(screen.getByText('0 activated clauses')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Policy' }));
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('status', { name: 'Action decision' })).toHaveTextContent('Version 2');
  });
  test('reset restores the applied policy after invalid edits', async () => {
    const user = await open();
    edit('bad');
    await user.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(
      JSON.parse(
        (screen.getByRole('textbox', { name: 'Policy JSON' }) as HTMLTextAreaElement).value,
      ),
    ).toEqual(getPolicyTemplate('draft-only').policy);
    expect(screen.getByRole('button', { name: 'Check action' })).toBeEnabled();
  });
  test('keyboard arrow navigation exposes the analysis panel', async () => {
    const user = await open();
    const policy = screen.getByRole('tab', { name: 'Policy' });
    await user.click(policy);
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Analysis' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Policy analysis' })).toBeVisible();
  });
});

describe('policy replacement boundaries', () => {
  test('changed policy clears the displayed decision and starts an empty session', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByText('1 recorded check')).toBeVisible();
    edit(JSON.stringify(getPolicyTemplate('read-only').policy));
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    expect(screen.queryByRole('status', { name: 'Action decision' })).not.toBeInTheDocument();
    expect(screen.getByText('0 recorded checks')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'git.commit');
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('status', { name: 'Action decision' })).toHaveTextContent('BLOCK');
  });
  test('an empty repository configuration cannot use the old repository selection', async () => {
    const user = await open();
    edit(JSON.stringify({ schemaVersion: 1, policyId: 'empty', repositories: [], diffs: [] }));
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    expect(screen.getByRole('alert')).toHaveTextContent('configured repository');
    expect(screen.getByText('0 recorded checks')).toBeVisible();
  });
  test('unknown schema fields cannot turn a rejected draft into current authority', async () => {
    const user = await open();
    edit(JSON.stringify({ ...getPolicyTemplate('draft-only').policy, externallyApproved: true }));
    await user.click(screen.getByRole('button', { name: 'Apply policy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('SCHEMA');
    expect(screen.getByText('Applied policy: draft-only')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check action' })).toBeDisabled();
  });
});

describe('independent workbench tools', () => {
  test('session inspection shares the active recorder and reset clears its displayed result', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    await user.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(screen.getByRole('heading', { name: 'Current session' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Recorded action checks' })).toHaveTextContent(
      'ALLOW',
    );
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(screen.getByText('0 recorded checks')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Policy' }));
    expect(screen.queryByRole('status', { name: 'Action decision' })).not.toBeInTheDocument();
  });
  test('invalid scenario drafts do not change the applied policy or current advisory records', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Check action' }));
    await user.click(screen.getByRole('tab', { name: 'Lab' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Scenario JSON' }), {
      target: { value: '{' },
    });
    await user.click(screen.getByRole('button', { name: 'Run sandbox scenario' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scenario validation failed');
    await user.click(screen.getByRole('tab', { name: 'Policy' }));
    expect(screen.getByText('Applied policy: draft-only')).toBeVisible();
    expect(screen.getByText('1 recorded check')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Action decision' })).toHaveTextContent('ALLOW');
  });
});

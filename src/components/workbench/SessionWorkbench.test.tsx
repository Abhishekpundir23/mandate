import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { getPolicyTemplate } from '../../policy/templates';
import { recordSession } from '../../sessions/record';
import { verifySession } from '../../sessions/verify';
import { SessionWorkbench } from './SessionWorkbench';

const read = { operation: 'workspace.readFile' as const, args: { repositoryId: 'mandate', path: 'README.md' } };
const push = { operation: 'git.push' as const, args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'a'.repeat(40) } };
const policy = JSON.stringify(getPolicyTemplate('draft-only').policy);
const session = recordSession(policy, [read, push], 'browser-test', 'Private label');
const change = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });

describe('session workbench', () => {
  test('inspects recorded declarations and exports independently verifiable JSON', () => {
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Current session' })).toBeVisible();
    const rows = within(screen.getByRole('region', { name: 'Session records' })).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('ALLOW');
    expect(rows[2]).toHaveTextContent('BLOCK');
    const output = screen.getByRole('textbox', { name: 'Session export JSON' }) as HTMLTextAreaElement;
    expect(output).toHaveAttribute('readonly');
    expect(verifySession(output.value).ok).toBe(true);
  });
  test('filters outcomes and opens the selected record explanation', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter outcome' }), 'BLOCK');
    const region = screen.getByRole('region', { name: 'Session records' });
    expect(within(region).getAllByRole('row')).toHaveLength(2);
    await user.click(within(region).getByRole('button', { name: 'Inspect check 2' }));
    expect(screen.getByRole('region', { name: 'Selected session check' })).toHaveTextContent('deny-push');
  });
  test('filters by operation and resource text before pagination', async () => {
    const user = userEvent.setup();
    const many = recordSession(policy, [...Array.from({ length: 12 }, () => read), ...Array.from({ length: 13 }, () => push)], 'many');
    render(<SessionWorkbench session={many} onReset={() => undefined} />);
    const region = screen.getByRole('region', { name: 'Session records' });
    expect(within(region).getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Next records' }));
    expect(screen.getByText('Page 2 of 3')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter operation' }), 'workspace.readFile');
    expect(screen.getByText('Page 1 of 2')).toBeVisible();
    change('Search records', 'not-present');
    expect(screen.getByText('No records match these filters.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next records' })).toBeDisabled();
  });
  test('imports a valid session with explicit lack of authentication', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    const imported = recordSession(policy, [push], 'imported');
    change('Import session JSON', JSON.stringify(imported));
    await user.click(screen.getByRole('button', { name: 'Verify session' }));
    expect(screen.getByRole('status', { name: 'Session import status' })).toHaveTextContent('Verified internally · not authenticated');
    expect(screen.getByRole('heading', { name: 'Imported session' })).toBeVisible();
    expect(JSON.parse((screen.getByRole('textbox', { name: 'Session export JSON' }) as HTMLTextAreaElement).value).sessionId).toBe('imported');
  });
  test('editing imported text invalidates the prior verification immediately', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    change('Import session JSON', JSON.stringify(session));
    await user.click(screen.getByRole('button', { name: 'Verify session' }));
    change('Import session JSON', '{');
    expect(screen.queryByRole('status', { name: 'Session import status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Session export JSON' })).not.toBeInTheDocument();
    expect(screen.getByText('Verify imported JSON before inspecting it.')).toBeVisible();
  });
  test('rejects a forged ALLOW and does not show it as verified', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    const forged = JSON.parse(JSON.stringify(session));
    forged.records[1].result.decision.outcome = 'ALLOW';
    change('Import session JSON', JSON.stringify(forged));
    await user.click(screen.getByRole('button', { name: 'Verify session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Session verification failed');
    expect(screen.queryByRole('status', { name: 'Session import status' })).not.toBeInTheDocument();
  });
  test('switches back to current records without adopting imported authority', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    change('Import session JSON', JSON.stringify(recordSession(policy, [], 'empty-import')));
    await user.click(screen.getByRole('button', { name: 'Verify session' }));
    await user.click(screen.getByRole('button', { name: 'Inspect current session' }));
    expect(screen.getByRole('heading', { name: 'Current session' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Session records' })).getAllByRole('row')).toHaveLength(3);
  });
  test('redaction omits raw paths, policy prose, labels and action arguments', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Show redacted report' }));
    const report = (screen.getByRole('textbox', { name: 'Redacted report JSON' }) as HTMLTextAreaElement).value;
    expect(JSON.parse(report).kind).toBe('redacted-session-report');
    expect(report).not.toContain('README.md');
    expect(report).not.toContain('Private label');
    expect(report).not.toContain('Inspect files and prepare');
    expect(report).not.toContain('commitOid');
  });
  test('compares verified sessions and clears a stale comparison on edit', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    change('Comparison session JSON', JSON.stringify(recordSession(policy, [read], 'shorter')));
    await user.click(screen.getByRole('button', { name: 'Compare sessions' }));
    expect(screen.getByRole('status', { name: 'Session comparison status' })).toHaveTextContent('1 changed record');
    change('Comparison session JSON', 'invalid');
    expect(screen.queryByRole('status', { name: 'Session comparison status' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare sessions' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Comparison session failed verification');
  });
  test('reset is explicit and only requests resetting the active recorder', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<SessionWorkbench session={session} onReset={reset} />);
    expect(reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('session inspector state isolation', () => {
  test('new recorder checks do not replace a separately inspected import', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionWorkbench session={session} onReset={() => undefined} />);
    const imported = recordSession(policy, [push], 'independent-import');
    change('Import session JSON', JSON.stringify(imported));
    await user.click(screen.getByRole('button', { name: 'Verify session' }));
    rerender(<SessionWorkbench session={recordSession(policy, [read, push, read], session.sessionId)} onReset={() => undefined} />);
    const exported = JSON.parse((screen.getByRole('textbox', { name: 'Session export JSON' }) as HTMLTextAreaElement).value);
    expect(exported.sessionId).toBe('independent-import');
    expect(exported.recordCount).toBe(1);
  });
  test('a recorder append invalidates an older comparison against that recorder', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SessionWorkbench session={session} onReset={() => undefined} />);
    change('Comparison session JSON', JSON.stringify(session));
    await user.click(screen.getByRole('button', { name: 'Compare sessions' }));
    expect(screen.getByRole('status', { name: 'Session comparison status' })).toHaveTextContent('0 changed records');
    rerender(<SessionWorkbench session={recordSession(policy, [read, push, read], session.sessionId, session.label)} onReset={() => undefined} />);
    expect(screen.queryByRole('status', { name: 'Session comparison status' })).not.toBeInTheDocument();
  });
  test('shrinking current records clamps pagination to a reachable page', async () => {
    const user = userEvent.setup();
    const many = recordSession(policy, Array.from({ length: 25 }, () => read), session.sessionId, session.label);
    const { rerender } = render(<SessionWorkbench session={many} onReset={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Next records' }));
    await user.click(screen.getByRole('button', { name: 'Next records' }));
    rerender(<SessionWorkbench session={session} onReset={() => undefined} />);
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Session records' })).getAllByRole('row')).toHaveLength(3);
  });
  test('record order can change without altering the immutable sequence values', async () => {
    const user = userEvent.setup();
    render(<SessionWorkbench session={session} onReset={() => undefined} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Record order' }), 'desc');
    const rows = within(screen.getByRole('table', { name: 'Recorded action checks' })).getAllByRole('row');
    expect(within(rows[1]!).getByRole('button')).toHaveAccessibleName('Inspect check 2');
    expect(session.records.map((record) => record.sequence)).toEqual([1, 2]);
  });
});

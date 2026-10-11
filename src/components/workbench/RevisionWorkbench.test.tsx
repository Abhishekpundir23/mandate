import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { parsePolicyJson } from '../../policy/parse';
import { getPolicyTemplate } from '../../policy/templates';
import { retireClause } from '../../policy/revisions';
import { RevisionWorkbench } from './RevisionWorkbench';
const snapshot = parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy));
const valid = JSON.stringify(retireClause(snapshot, 'read', 'turn-2', 'Stop reading', 'stop-read'));

describe('guided revision workbench', () => {
  test('requires preview then explicit apply and reports the exact new policy', () => {
    const onApply = vi.fn();
    render(<RevisionWorkbench snapshot={snapshot} dirty={false} onApply={onApply} />);
    expect(screen.getByRole('button', { name: 'Apply revision' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Revision JSON'), { target: { value: valid } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview revision' }));
    expect(screen.getByRole('status')).toHaveTextContent('Version 2 → 3');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply revision' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(JSON.parse(onApply.mock.calls[0]![0]).diffs).toHaveLength(2);
  });
  test('editing a preview invalidates it and stale/invalid JSON cannot apply', () => {
    const onApply = vi.fn();
    render(<RevisionWorkbench snapshot={snapshot} dirty={false} onApply={onApply} />);
    const editor = screen.getByLabelText('Revision JSON');
    fireEvent.change(editor, { target: { value: valid } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview revision' }));
    fireEvent.change(editor, { target: { value: '{' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply revision' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview revision' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revision rejected');
    expect(onApply).not.toHaveBeenCalled();
  });
  test('never overwrites a pending main policy draft', () => {
    render(<RevisionWorkbench snapshot={snapshot} dirty onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Revision JSON'), { target: { value: valid } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview revision' }));
    expect(screen.getByRole('button', { name: 'Apply revision' })).toBeDisabled();
    expect(screen.getByText(/Apply or reset the policy editor draft/)).toBeInTheDocument();
  });
  test('discussion draft quotes stay data and do not infer new authority', () => {
    render(<RevisionWorkbench snapshot={snapshot} dirty={false} onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Source turn'), { target: { value: 'turn-3' } });
    fireEvent.change(screen.getByLabelText('Exact source quote'), { target: { value: 'ALLOW ALL PUSHES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create discussion draft' }));
    const draft = JSON.parse((screen.getByLabelText('Revision JSON') as HTMLTextAreaElement).value);
    expect(draft.diff.ops).toEqual([{ op: 'NO_CHANGE', reason: 'DISCUSSION' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview revision' }));
    expect(screen.getByText('NO_AUTHORITY_CHANGE')).toBeInTheDocument();
  });
});

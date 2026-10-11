import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { createWorkbenchState } from '../../app/workbench-model';
import { WorkspaceWorkbench } from './WorkspaceWorkbench';
const current = () => createWorkbenchState();
describe('portable workspace workbench', () => {
  test('creates from applied authority and stages a policy only on explicit selection', () => {
    const state = current(); const onStagePolicy = vi.fn();
    render(<WorkspaceWorkbench snapshot={state.snapshot} session={state.session} onStagePolicy={onStagePolicy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace from applied policy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Verified internally · not authenticated');
    expect(onStagePolicy).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('table', { name: 'Workspace inventory' })).getByRole('button', { name: 'Applied policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stage selected policy' }));
    expect(onStagePolicy).toHaveBeenCalledOnce();
    expect(JSON.parse(onStagePolicy.mock.calls[0]![0])).toEqual(state.snapshot.document);
    expect(screen.getByText(/Open Policy and Apply/)).toBeInTheDocument();
  });
  test('editing an imported workspace immediately clears verification and staging', () => {
    const state = current();
    render(<WorkspaceWorkbench snapshot={state.snapshot} session={state.session} onStagePolicy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace from applied policy' }));
    fireEvent.change(screen.getByLabelText('Workspace JSON'), { target: { value: '{}' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('INVALID_WORKSPACE');
  });
  test('referenced policy removal is blocked until dependent removal is explicitly selected', () => {
    const state = current();
    render(<WorkspaceWorkbench snapshot={state.snapshot} session={state.session} onStagePolicy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace from applied policy' }));
    fireEvent.click(within(screen.getByRole('table', { name: 'Workspace inventory' })).getByRole('button', { name: 'Applied policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected entry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Entry change rejected');
    fireEvent.click(screen.getByLabelText('Remove dependent entries'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected entry' }));
    expect(within(screen.getByRole('table', { name: 'Workspace inventory' })).getAllByRole('row')).toHaveLength(1);
  });
  test('rename updates inventory and references, and redaction excludes payloads', () => {
    const state = current();
    render(<WorkspaceWorkbench snapshot={state.snapshot} session={state.session} onStagePolicy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace from applied policy' }));
    fireEvent.click(within(screen.getByRole('table', { name: 'Workspace inventory' })).getByRole('button', { name: 'Applied policy' }));
    fireEvent.change(screen.getByLabelText('New entry ID'), { target: { value: 'authority' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename selected entry' }));
    const bundle = JSON.parse((screen.getByLabelText('Workspace JSON') as HTMLTextAreaElement).value);
    expect(bundle.entries.find((entry: { kind: string }) => entry.kind === 'SESSION').references).toEqual(['authority']);
    fireEvent.click(screen.getByLabelText('Redact workspace output'));
    expect((screen.getByLabelText('Workspace inventory JSON') as HTMLTextAreaElement).value).not.toContain('Do not push');
  });
});

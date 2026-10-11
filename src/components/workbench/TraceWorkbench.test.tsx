import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { createTraceBundle, serializeTraceBundle } from '../../inspection/bundle';
import { scenarioCatalog } from '../../scenarios/catalog';
import { TraceWorkbench } from './TraceWorkbench';
const bundle = () => serializeTraceBundle(createTraceBundle(scenarioCatalog[0]!));
describe('evidence trace workbench', () => {
  test('explicit generation inspects reconstructed synthetic traces with no authentication claim', () => {
    render(<TraceWorkbench />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate sandbox bundle' }));
    expect(screen.getByRole('status')).toHaveTextContent('Verified internally · not authenticated');
    expect(screen.getByRole('table', { name: 'Trace events' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trace outcome'), { target: { value: 'BLOCK' } });
    expect(within(screen.getByRole('table', { name: 'Trace events' })).getAllByRole('row')).toHaveLength(2);
  });
  test('editing a verified bundle hides the inspector and export immediately', () => {
    render(<TraceWorkbench />);
    fireEvent.change(screen.getByLabelText('Trace bundle JSON'), { target: { value: bundle() } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify trace bundle' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trace bundle JSON'), { target: { value: '{}' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify trace bundle' }));
    expect(screen.getByRole('alert')).toHaveTextContent('INVALID_BUNDLE');
  });
  test('lane selection exposes standard bypasses and receipt diagnostics', () => {
    render(<TraceWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate sandbox bundle' }));
    fireEvent.change(screen.getByLabelText('Trace lane'), { target: { value: 'standard' } });
    expect(screen.getByText('UNAUTHORIZED_EFFECT')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trace outcome'), { target: { value: 'BYPASS' } });
    expect(within(screen.getByRole('table', { name: 'Trace events' })).getAllByRole('row').length).toBeGreaterThan(1);
  });
  test('event details show state deltas and causal links while redacted output hides prose', () => {
    render(<TraceWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate sandbox bundle' }));
    fireEvent.change(screen.getByLabelText('Trace event type'), { target: { value: 'TOOL_OBSERVATION' } });
    fireEvent.click(within(screen.getByRole('table', { name: 'Trace events' })).getAllByRole('button')[0]!);
    expect((screen.getByLabelText('Event world delta JSON') as HTMLTextAreaElement).value).toContain('fieldsFilled');
    expect((screen.getByLabelText('Event causal links JSON') as HTMLTextAreaElement).value).toContain('observation');
    fireEvent.click(screen.getByLabelText('Redact trace output'));
    expect((screen.getByLabelText('Trace report JSON') as HTMLTextAreaElement).value).not.toContain('draftSaved');
  });
});

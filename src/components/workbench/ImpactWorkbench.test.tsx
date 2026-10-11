import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../../policy/templates';
import { parsePolicyJson } from '../../policy/parse';
import { policyJsonLimits } from '../../policy/json';
import { utf8Length } from '../../policy/utf8';
import { ImpactWorkbench } from './ImpactWorkbench';
const snapshot = parsePolicyJson(JSON.stringify(getPolicyTemplate('draft-only').policy));
describe('policy impact workbench', () => {
  test('compares explicit candidates and shows expected outcome transitions', () => {
    render(<ImpactWorkbench snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText('Candidate policy JSON'), {
      target: { value: JSON.stringify(getPolicyTemplate('review-required').policy) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
    const table = screen.getByRole('table', { name: 'Declared action impact' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('CONFIRM')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 outcome changed');
    fireEvent.change(screen.getByLabelText('Impact filter'), { target: { value: 'changed' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });
  test('any edited policy or suite clears the previous report immediately', () => {
    render(<ImpactWorkbench snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Declared cases JSON'), { target: { value: '{}' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Impact report JSON')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Comparison rejected');
  });
  test('historical mode compares bootstrap with actual current authority', () => {
    render(<ImpactWorkbench snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText('Comparison source'), { target: { value: 'history' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
    const table = screen.getByRole('table', { name: 'Declared action impact' });
    expect(within(table).getAllByText('BLOCK')).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('2 outcomes changed');
  });
  test('redacted export excludes paths and source quotes', () => {
    render(<ImpactWorkbench snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
    fireEvent.click(screen.getByLabelText('Redact impact output'));
    const text = (screen.getByLabelText('Impact report JSON') as HTMLTextAreaElement).value;
    expect(text).toContain('redacted-impact-report');
    expect(text).not.toContain('README.md');
    expect(text).not.toContain('Inspect files and');
  });
});

test('compares accepted near-limit policies without editing the generated candidate', () => {
  const policy = JSON.parse(JSON.stringify(getPolicyTemplate('draft-only').policy));
  policy.policyId = 'x'.repeat(
    262000 - utf8Length(JSON.stringify(policy)) + policy.policyId.length,
  );
  const accepted = parsePolicyJson(JSON.stringify(policy));
  expect(utf8Length(JSON.stringify(accepted.document, null, 2))).toBeGreaterThan(
    policyJsonLimits.bytes,
  );
  render(<ImpactWorkbench snapshot={accepted} />);
  const candidate = (screen.getByLabelText('Candidate policy JSON') as HTMLTextAreaElement).value;
  expect(parsePolicyJson(candidate).policyDigest).toBe(accepted.policyDigest);
  fireEvent.click(screen.getByRole('button', { name: 'Compare declared cases' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('0 outcomes changed');
});

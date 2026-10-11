import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { maintainedCampaign } from '../../campaigns/catalog';
import { CampaignWorkbench } from './CampaignWorkbench';
describe('adversarial campaign workbench', () => {
  test('runs the maintained invariants and distinguishes expected rejections from failures', () => {
    render(<CampaignWorkbench />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    expect(screen.getByRole('status')).toHaveTextContent('0 failed');
    expect(screen.getByRole('table', { name: 'Campaign results' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Campaign result filter'), {
      target: { value: 'failed' },
    });
    expect(
      within(screen.getByRole('table', { name: 'Campaign results' })).getAllByRole('row'),
    ).toHaveLength(1);
    expect(screen.getByText('No campaign cases match.')).toBeInTheDocument();
  });
  test('editing campaign input immediately clears the prior report', () => {
    render(<CampaignWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    fireEvent.change(screen.getByLabelText('Campaign JSON'), { target: { value: '{}' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Campaign report JSON')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Campaign rejected');
  });
  test('running unchanged source twice exposes an identical comparison', () => {
    render(<CampaignWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    expect(screen.getByText('Compared with previous run: 0 changed cases.')).toBeInTheDocument();
  }, 30000);
  test('redacted outputs omit case titles and detailed attack payloads', () => {
    render(<CampaignWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Run campaign' }));
    fireEvent.click(screen.getByLabelText('Redact campaign output'));
    const text = (screen.getByLabelText('Campaign report JSON') as HTMLTextAreaElement).value;
    expect(text).toContain('redacted-campaign-report');
    expect(text).not.toContain('Caller-chosen evidence');
    expect(text).not.toContain('scenario-control');
  });
});

test('changed campaigns compare with the last successful run across rejected drafts', () => {
  const campaign = JSON.parse(
    JSON.stringify({
      ...maintainedCampaign,
      scenarios: [],
      cases: [maintainedCampaign.cases.find((item) => item.kind === 'POLICY')],
    }),
  );
  render(<CampaignWorkbench />);
  const editor = screen.getByLabelText('Campaign JSON');
  const run = screen.getByRole('button', { name: 'Run campaign' });
  fireEvent.change(editor, { target: { value: JSON.stringify(campaign) } });
  fireEvent.click(run);
  expect(screen.getByRole('status')).toHaveTextContent('0 failed');
  fireEvent.change(editor, { target: { value: '{}' } });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(run);
  expect(screen.getByRole('alert')).toHaveTextContent('Campaign rejected');
  campaign.cases[0].expected.passed = false;
  fireEvent.change(editor, { target: { value: JSON.stringify(campaign) } });
  fireEvent.click(run);
  expect(screen.getByRole('status')).toHaveTextContent('1 failed');
  expect(screen.getByText('Compared with previous run: 1 changed cases.')).toBeInTheDocument();
  fireEvent.click(run);
  expect(screen.getByText('Compared with previous run: 0 changed cases.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load maintained campaign' }));
  fireEvent.change(editor, { target: { value: JSON.stringify(campaign) } });
  fireEvent.click(run);
  expect(screen.queryByText(/Compared with previous run:/)).toBeNull();
});

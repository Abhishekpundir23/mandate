import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AccessibleTabs } from './AccessibleTabs';

const tabs = [
  { id: 'standard', label: 'Standard', content: <p>Standard trace</p> },
  { id: 'mandate', label: 'Mandate', content: <p>Mandate trace</p> },
] as const;

describe('AccessibleTabs', () => {
  it('links one selected tab to one visible panel', () => {
    render(<AccessibleTabs label="Agent traces" tabs={tabs} defaultTabId="standard" />);

    const standard = screen.getByRole('tab', { name: 'Standard' });
    expect(standard).toHaveAttribute('aria-selected', 'true');
    expect(standard).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'Standard' })).toBeVisible();
    expect(screen.queryByRole('tabpanel', { name: 'Mandate' })).not.toBeInTheDocument();
  });

  it('supports arrows, Home, and End with roving focus', async () => {
    const user = userEvent.setup();
    render(<AccessibleTabs label="Agent traces" tabs={tabs} defaultTabId="standard" />);
    const standard = screen.getByRole('tab', { name: 'Standard' });
    const mandate = screen.getByRole('tab', { name: 'Mandate' });

    standard.focus();
    await user.keyboard('{ArrowRight}');
    expect(mandate).toHaveFocus();
    expect(mandate).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(standard).toHaveFocus();
    await user.keyboard('{End}');
    expect(mandate).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(standard).toHaveFocus();
  });
});

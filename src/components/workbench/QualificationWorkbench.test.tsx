import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { QualificationWorkbench } from './QualificationWorkbench';
test('runs explicit profile criteria and clears stale qualification on edits', () => {
  render(<QualificationWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Run qualification' }));
  expect(screen.getByRole('status')).toHaveTextContent('Declared criteria passed');
  fireEvent.change(screen.getByLabelText('Qualification profile JSON'), {
    target: { value: '{}' },
  });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run qualification' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Profile rejected');
});
test('independently verifies saved reports and invalidates the result when edited', () => {
  render(<QualificationWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Run qualification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verify saved qualification report' }));
  expect(
    screen.getByText('Report independently reconstructed. Consistency is not authentication.'),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('Saved qualification report JSON'), {
    target: { value: '{}' },
  });
  expect(
    screen.queryByText('Report independently reconstructed. Consistency is not authentication.'),
  ).toBeNull();
});

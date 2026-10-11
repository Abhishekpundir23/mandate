import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { exampleQualificationProfile } from '../../qualification/index';
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

test('oversized qualification output is recoverable and preserves neighboring state', () => {
  const profile = JSON.parse(JSON.stringify(exampleQualificationProfile));
  profile.policy.diffs[0].ops[0].clause.id = 'read-' + 'x'.repeat(50000);
  profile.cases.cases = Array.from({ length: 100 }, (_, index) => ({
    ...profile.cases.cases[0],
    id: 'read-' + index,
  }));
  profile.criteria.requiredCaseIds = [];
  profile.criteria.maximumOutcomes.ALLOW = 100;
  render(
    <>
      <label>
        Neighboring draft
        <input aria-label="Neighboring draft" defaultValue="keep me" />
      </label>
      <QualificationWorkbench />
    </>,
  );
  fireEvent.change(screen.getByLabelText('Baseline qualification report JSON'), {
    target: { value: 'preserve baseline' },
  });
  fireEvent.change(screen.getByLabelText('Qualification profile JSON'), {
    target: { value: JSON.stringify(profile) },
  });
  expect(() =>
    fireEvent.click(screen.getByRole('button', { name: 'Run qualification' })),
  ).not.toThrow();
  expect(screen.getByRole('alert')).toHaveTextContent('Profile rejected');
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByLabelText('Qualification output JSON')).toBeNull();
  expect(screen.getByLabelText('Saved qualification report JSON')).toHaveValue('');
  expect(screen.getByLabelText('Neighboring draft')).toHaveValue('keep me');
  expect(screen.getByLabelText('Baseline qualification report JSON')).toHaveValue(
    'preserve baseline',
  );
  fireEvent.change(screen.getByLabelText('Qualification profile JSON'), {
    target: { value: JSON.stringify(exampleQualificationProfile) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run qualification' }));
  expect(screen.getByRole('status')).toHaveTextContent('Declared criteria passed');
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the locked product wordmark and local-safety notice', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'MANDATE' })).toBeInTheDocument();
    expect(screen.getByText('No real external action')).toBeInTheDocument();
  });
});

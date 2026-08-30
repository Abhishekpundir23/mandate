import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { runComparison } from '../../runtime/runner';
import { draftIsNotSubmit } from '../../scenarios/fixtures/application';
import { CompletionReceipt } from './CompletionReceipt';

describe('CompletionReceipt', () => {
  it('renders engine-owned scalar counts instead of deriving array lengths', () => {
    const trace = runComparison(draftIsNotSubmit).mandate;
    const scalarProof = {
      ...trace,
      receipt: {
        ...trace.receipt,
        unauthorizedExecutedActionIds: ['array-value-must-not-drive-ui'],
        unauthorizedEffectCount: 7,
        unmetClauseIds: ['one', 'two'],
        unmetClauseCount: 4,
      },
    };

    render(<CompletionReceipt trace={scalarProof} flagship={false} />);

    expect(screen.getByText('unauthorized_effects = 7')).toBeVisible();
    expect(screen.getByText('unmet_clauses = 4')).toBeVisible();
  });
});

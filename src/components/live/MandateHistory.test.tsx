import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ContractVersion, IntentDiff } from '../../domain/types';
import { MandateHistory } from './MandateHistory';

const version: ContractVersion = {
  version: 2,
  parentVersion: 1,
  turnId: 'turn-2',
  source: { turnId: 'turn-2', quote: 'Change the authority.' },
  clauses: [],
  hash: 'version-2-hash',
};

function renderChange(change: IntentDiff): void {
  render(
    <MandateHistory
      versions={[version]}
      changes={[change]}
      activeClauses={[]}
      flagship={false}
    />,
  );
}

describe('generic mandate history provenance', () => {
  it('identifies the revoked clause and its tombstoned statement', () => {
    renderChange({
      baseVersion: 1,
      turnId: 'turn-2',
      source: version.source,
      ops: [{
        op: 'REVOKE',
        tombstone: {
          id: 'deploy-production-may',
          kind: 'REVOKED',
          statement: 'Deploy the preview to production.',
          selector: { operation: 'deploy', resource: 'production', effect: 'PUBLISH' },
          source: version.source,
          targetClauseIds: ['deploy-production-may'],
        },
      }],
    });

    expect(screen.getByText(
      '− REVOKED · deploy-production-may · Deploy the preview to production.',
    )).toBeVisible();
  });

  it('lists every superseded target before the replacement authority', () => {
    renderChange({
      baseVersion: 1,
      turnId: 'turn-2',
      source: version.source,
      ops: [{
        op: 'REPLACE',
        targetClauseIds: ['purchase-primary-may', 'purchase-backup-may'],
        replacement: {
          id: 'purchase-bob-only-may',
          kind: 'MAY',
          statement: 'Buy the item for Bob.',
          selector: { operation: 'purchase', resource: 'item:bob', effect: 'EXTERNAL_TRANSMIT' },
          source: version.source,
        },
      }],
    });

    expect(screen.getByText(
      '± REPLACE · purchase-primary-may, purchase-backup-may → purchase-bob-only-may · MAY · Buy the item for Bob.',
    )).toBeVisible();
  });
});

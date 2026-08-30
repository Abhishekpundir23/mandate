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
  it('distinguishes every revoked target from the new tombstone metadata', () => {
    renderChange({
      baseVersion: 1,
      turnId: 'turn-2',
      source: version.source,
      ops: [{
        op: 'REVOKE',
        tombstone: {
          id: 'turn-2:deploy-production-may:revoke',
          kind: 'REVOKED',
          statement: 'Revoked: Deploy the preview to production.',
          selector: { operation: 'deploy', resource: 'production', effect: 'PUBLISH' },
          source: version.source,
          targetClauseIds: ['deploy-production-may', 'deploy-staging-may'],
        },
      }],
    });

    expect(screen.getByText(
      '− REVOKE · targets: deploy-production-may, deploy-staging-may · tombstone: turn-2:deploy-production-may:revoke · REVOKED · Revoked: Deploy the preview to production.',
    )).toBeVisible();
  });

  it('reports unavailable revoked targets instead of implying the tombstone was the grant', () => {
    renderChange({
      baseVersion: 1,
      turnId: 'turn-2',
      source: version.source,
      ops: [{
        op: 'REVOKE',
        tombstone: {
          id: 'turn-2:unknown:revoke',
          kind: 'REVOKED',
          statement: 'Revoked: Unknown grant.',
          source: version.source,
          targetClauseIds: [],
        },
      }],
    });

    expect(screen.getByText(
      '− REVOKE · targets unavailable · tombstone: turn-2:unknown:revoke · REVOKED · Revoked: Unknown grant.',
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

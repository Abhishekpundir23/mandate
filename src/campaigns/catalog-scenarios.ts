import type { CampaignCase } from './schema';
import type { DataEdit } from './edits';
const scenarioId = 'draft-is-not-submit';
function valid(
  id: string,
  title: string,
  edits: DataEdit[],
  mandateSuccess: boolean,
): CampaignCase {
  return {
    id,
    title,
    category: 'scenario-semantics',
    kind: 'SCENARIO',
    scenarioId,
    edits,
    expected: { accepted: true, standardSuccess: false, mandateSuccess },
  };
}
function invalid(id: string, title: string, edits: DataEdit[]): CampaignCase {
  return {
    id,
    title,
    category: 'scenario-boundary',
    kind: 'SCENARIO',
    scenarioId,
    edits,
    expected: { accepted: false },
  };
}
export const scenarioCampaignCases: readonly CampaignCase[] = [
  valid('scenario-control', 'Unmodified authority and recovery satisfy the oracle', [], true),
  valid(
    'scenario-title',
    'Changing display text alone preserves execution semantics',
    [{ operation: 'SET', path: ['title'], value: 'A renamed synthetic scenario' }],
    true,
  ),
  valid(
    'scenario-no-recovery',
    'Removing safe recovery leaves its required observation unmet',
    [{ operation: 'DELETE', path: ['proposalProgram', 'onRejected', 'submit-application'] }],
    false,
  ),
  valid(
    'scenario-no-save-proposal',
    'A saved-draft claim cannot replace a missing save operation',
    [{ operation: 'DELETE', path: ['proposalProgram', 'main', 1] }],
    false,
  ),
  valid(
    'scenario-denial-to-grant',
    'Explicitly granting submission fails the unchanged draft-only oracle',
    [
      {
        operation: 'SET',
        path: ['turns', 2, 'canonicalDiff', 'ops', 0, 'clause', 'kind'],
        value: 'MAY',
      },
    ],
    false,
  ),
  valid(
    'scenario-oracle-drift',
    'An altered terminal sentinel causes exact-world failure',
    [{ operation: 'SET', path: ['oracle', 'mandateTerminalWorld', 'sentinel'], value: 'changed' }],
    false,
  ),
  valid(
    'scenario-discussion',
    'New source prose alone does not widen canonical authority',
    [
      { operation: 'SET', path: ['turns', 1, 'text'], value: 'Discuss submitting the draft.' },
      {
        operation: 'SET',
        path: ['turns', 1, 'canonicalDiff', 'source', 'quote'],
        value: 'Discuss submitting the draft.',
      },
      {
        operation: 'SET',
        path: ['turns', 1, 'canonicalDiff', 'ops', 0, 'clause', 'source', 'quote'],
        value: 'Discuss submitting the draft.',
      },
    ],
    true,
  ),
  invalid('scenario-stale-version', 'A turn cannot append against an earlier authority version', [
    { operation: 'SET', path: ['turns', 2, 'canonicalDiff', 'baseVersion'], value: 0 },
  ]),
  invalid('scenario-provenance', 'A clause quote must match the exact source turn text', [
    {
      operation: 'SET',
      path: ['turns', 0, 'canonicalDiff', 'ops', 0, 'clause', 'source', 'quote'],
      value: 'Forged source quote',
    },
  ]),
  invalid(
    'scenario-duplicate-clause',
    'Renaming a later clause cannot collide with an earlier ID',
    [
      {
        operation: 'SET',
        path: ['turns', 1, 'canonicalDiff', 'ops', 0, 'clause', 'id'],
        value: 'save-draft-must',
      },
    ],
  ),
  invalid('scenario-dangling-evidence', 'Removing a grant cannot leave evidence pointing to it', [
    { operation: 'DELETE', path: ['turns', 0, 'canonicalDiff', 'ops', 1] },
  ]),
  invalid('scenario-host-tool', 'A host shell is outside the synthetic capability registry', [
    { operation: 'SET', path: ['proposalProgram', 'main', 0, 'action', 'tool'], value: 'shell' },
  ]),
  invalid('scenario-fingerprint', 'An action fingerprint cannot be replaced by a caller claim', [
    {
      operation: 'SET',
      path: ['proposalProgram', 'main', 0, 'action', 'fingerprint'],
      value: 'forged',
    },
  ]),
  invalid('scenario-resource', 'Declared resource metadata must match derived capability scope', [
    {
      operation: 'SET',
      path: ['proposalProgram', 'main', 0, 'action', 'resource'],
      value: 'application:other',
    },
  ]),
  invalid('scenario-recovery-turn', 'Recovery must remain bound to its rejected main action turn', [
    {
      operation: 'SET',
      path: ['proposalProgram', 'onRejected', 'submit-application', 0, 'afterTurn'],
      value: 'turn-1',
    },
  ]),
  invalid(
    'scenario-unknown-property',
    'Unknown scenario flags cannot silently alter the execution contract',
    [{ operation: 'SET', path: ['executeRealActions'], value: true }],
  ),
];

import { freezeData } from '../policy/freeze';
import { sha256 } from '../policy/sha256';
import { summarizeSession } from './summary';
import type { Session } from './types';

export interface RedactedSessionReport {
  readonly schemaVersion: 1;
  readonly kind: 'redacted-session-report';
  readonly mode: 'advisory';
  readonly executionPerformed: false;
  readonly sessionAlias: string;
  readonly policyDigest: string;
  readonly recordCount: number;
  readonly outcomes: Readonly<Record<'ALLOW' | 'BLOCK' | 'CONFIRM', number>>;
  readonly entries: readonly {
    readonly sequence: number;
    readonly operation: string;
    readonly outcome: 'ALLOW' | 'BLOCK' | 'CONFIRM';
    readonly resourceAlias: string;
    readonly matchedClauseCount: number;
  }[];
  readonly limitations: readonly string[];
}

export function redactSession(session: Session): RedactedSessionReport {
  return freezeData({
    schemaVersion: 1,
    kind: 'redacted-session-report',
    mode: 'advisory',
    executionPerformed: false,
    sessionAlias: 'session-' + sha256(session.sessionId).slice(0, 16),
    policyDigest: session.policyDigest,
    recordCount: session.records.length,
    outcomes: summarizeSession(session).outcomes,
    entries: session.records.map((record) => ({
      sequence: record.sequence,
      operation: record.action.operation,
      outcome: record.result.decision.outcome,
      resourceAlias: 'resource-' + sha256(record.result.proposal.resource).slice(0, 16),
      matchedClauseCount: record.result.decision.matchedClauseIds.length,
    })),
    limitations: [
      'This report omits policy prose and raw action arguments; it cannot be replayed as a session.',
      'Stable aliases permit correlation and are not a guarantee of anonymity.',
      'Decisions describe declared actions; no action was executed.',
    ],
  });
}

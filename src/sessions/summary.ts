import { freezeData } from '../policy/freeze';
import type { Session } from './types';

export interface SessionSummary {
  readonly mode: 'advisory';
  readonly executionPerformed: false;
  readonly sessionId: string;
  readonly label: string;
  readonly policyDigest: string;
  readonly recordCount: number;
  readonly outcomes: Readonly<Record<'ALLOW' | 'BLOCK' | 'CONFIRM', number>>;
  readonly operations: Readonly<Record<'workspace.readFile' | 'git.commit' | 'git.push', number>>;
  readonly distinctResources: number;
  readonly contractVersions: readonly number[];
}

export function summarizeSession(session: Session): SessionSummary {
  return freezeData({
    mode: 'advisory',
    executionPerformed: false,
    sessionId: session.sessionId,
    label: session.label,
    policyDigest: session.policyDigest,
    recordCount: session.records.length,
    outcomes: {
      ALLOW: session.records.filter((record) => record.result.decision.outcome === 'ALLOW').length,
      BLOCK: session.records.filter((record) => record.result.decision.outcome === 'BLOCK').length,
      CONFIRM: session.records.filter((record) => record.result.decision.outcome === 'CONFIRM')
        .length,
    },
    operations: {
      'workspace.readFile': session.records.filter(
        (record) => record.action.operation === 'workspace.readFile',
      ).length,
      'git.commit': session.records.filter((record) => record.action.operation === 'git.commit')
        .length,
      'git.push': session.records.filter((record) => record.action.operation === 'git.push').length,
    },
    distinctResources: new Set(session.records.map((record) => record.result.proposal.resource))
      .size,
    contractVersions: [
      ...new Set(session.records.map((record) => record.result.contractVersion)),
    ].sort((a, b) => a - b),
  });
}

import { freezeData } from '../policy/freeze';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import type { Session } from './types';

type Outcome = 'ALLOW' | 'BLOCK' | 'CONFIRM';
export interface SessionChange {
  readonly sequence: number;
  readonly kind: 'ADDED' | 'REMOVED' | 'ACTION_CHANGED' | 'DECISION_CHANGED';
  readonly beforeOutcome: Outcome | null;
  readonly afterOutcome: Outcome | null;
  readonly beforeFingerprint: string | null;
  readonly afterFingerprint: string | null;
}
export interface SessionComparison {
  readonly policyChanged: boolean;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly unchangedCount: number;
  readonly changes: readonly SessionChange[];
}

export function compareSessions(left: Session, right: Session): SessionComparison {
  const changes: SessionChange[] = [];
  let unchangedCount = 0;
  const length = Math.max(left.records.length, right.records.length);
  for (let index = 0; index < length; index += 1) {
    const before = left.records[index];
    const after = right.records[index];
    const actionChanged =
      before !== undefined &&
      after !== undefined &&
      canonicalize(normalizeJsonValue(before.action)) !==
        canonicalize(normalizeJsonValue(after.action));
    const decisionChanged =
      before !== undefined &&
      after !== undefined &&
      canonicalize(normalizeJsonValue(before.result.decision)) !==
        canonicalize(normalizeJsonValue(after.result.decision));
    const kind =
      before === undefined
        ? 'ADDED'
        : after === undefined
          ? 'REMOVED'
          : actionChanged
            ? 'ACTION_CHANGED'
            : decisionChanged
              ? 'DECISION_CHANGED'
              : undefined;
    if (kind === undefined) {
      unchangedCount += 1;
      continue;
    }
    changes.push({
      sequence: index + 1,
      kind,
      beforeOutcome: before?.result.decision.outcome ?? null,
      afterOutcome: after?.result.decision.outcome ?? null,
      beforeFingerprint: before?.result.proposal.fingerprint ?? null,
      afterFingerprint: after?.result.proposal.fingerprint ?? null,
    });
  }
  return freezeData({
    policyChanged: left.policyDigest !== right.policyDigest,
    beforeCount: left.records.length,
    afterCount: right.records.length,
    unchangedCount,
    changes,
  });
}

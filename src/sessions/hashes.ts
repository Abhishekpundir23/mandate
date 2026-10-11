import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { sha256 } from '../policy/sha256';
import type { Session, SessionRecord } from './types';

export function sessionRootHash(session: Pick<Session, 'schemaVersion' | 'mode' | 'executionPerformed' | 'sessionId' | 'label' | 'policy' | 'policyDigest'>): string {
  return sha256(canonicalize(normalizeJsonValue({
    schemaVersion: session.schemaVersion,
    mode: session.mode,
    executionPerformed: session.executionPerformed,
    sessionId: session.sessionId,
    label: session.label,
    policy: session.policy,
    policyDigest: session.policyDigest,
  })));
}

export function sessionRecordHash(record: Omit<SessionRecord, 'hash'>): string {
  return sha256(canonicalize(normalizeJsonValue({
    sequence: record.sequence,
    action: record.action,
    result: record.result,
    previousHash: record.previousHash,
  })));
}

import { freezeData } from '../policy/freeze';
import { codingActionSchema } from '../policy/actions';
import { normalizeBoundedJson, actionJsonLimits } from '../policy/json';
import { parsePolicyJson } from '../policy/parse';
import { checkAction } from '../policy/service';
import type { AuthoritySnapshot } from '../policy/types';
import { utf8Length } from '../policy/utf8';
import { sessionRootHash, sessionRecordHash } from './hashes';
import { sessionIdentitySchema, sessionLimits } from './schema';
import { verifySession } from './verify';
import type { Session, SessionRecord } from './types';

function bounded(session: Session): Session {
  if (utf8Length(JSON.stringify(session)) > sessionLimits.bytes)
    throw new Error('Session byte limit');
  return freezeData(session);
}

export function createSession(policyText: string, id: string, label = ''): Session {
  const identity = sessionIdentitySchema.parse({ sessionId: id, label });
  const snapshot = parsePolicyJson(policyText);
  const header = {
    schemaVersion: 1 as const,
    mode: 'advisory' as const,
    executionPerformed: false as const,
    sessionId: identity.sessionId,
    label: identity.label,
    policy: snapshot.document,
    policyDigest: snapshot.policyDigest,
  };
  const rootHash = sessionRootHash(header);
  return bounded({ ...header, rootHash, records: [], recordCount: 0, terminalHash: rootHash });
}

function appendValidated(session: Session, snapshot: AuthoritySnapshot, input: unknown): Session {
  if (session.records.length >= 500) throw new Error('Session record limit');
  const action = codingActionSchema.parse(normalizeBoundedJson(input, actionJsonLimits));
  const result = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action });
  const payload = {
    sequence: session.records.length + 1,
    action,
    result,
    previousHash: session.terminalHash,
  };
  const record: SessionRecord = { ...payload, hash: sessionRecordHash(payload) };
  return bounded({
    ...session,
    records: [...session.records, record],
    recordCount: record.sequence,
    terminalHash: record.hash,
  });
}

export function appendSessionCheck(session: Session, action: unknown): Session {
  const verified = verifySession(JSON.stringify(normalizeBoundedJson(session, sessionLimits)));
  if (!verified.ok) throw new Error('Invalid session');
  const snapshot = parsePolicyJson(JSON.stringify(verified.session.policy));
  return appendValidated(verified.session, snapshot, action);
}

/** Batch API avoids repeatedly replaying an already owned immutable prefix. */
export function recordSession(
  policyText: string,
  actions: readonly unknown[],
  id: string,
  label = '',
): Session {
  if (!Array.isArray(actions) || actions.length > 500) throw new Error('Session record limit');
  if (
    Object.getOwnPropertySymbols(actions).length > 0 ||
    Object.getOwnPropertyNames(actions).length !== actions.length + 1
  )
    throw new Error('Invalid action list');
  const ownedActions: unknown[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(actions, String(index));
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error('Invalid action list');
    ownedActions.push(normalizeBoundedJson(descriptor.value, actionJsonLimits));
  }
  let session = createSession(policyText, id, label);
  const snapshot = parsePolicyJson(policyText);
  for (const action of ownedActions) session = appendValidated(session, snapshot, action);
  return session;
}

export function serializeSession(session: Session): string {
  const text = JSON.stringify(normalizeBoundedJson(session, sessionLimits));
  const verified = verifySession(text);
  if (!verified.ok) throw new Error('Invalid session');
  const readable = JSON.stringify(verified.session, null, 2);
  return utf8Length(readable) <= sessionLimits.bytes ? readable : JSON.stringify(verified.session);
}

import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import { parseBoundedJson } from '../policy/json';
import { parsePolicyJson } from '../policy/parse';
import { checkAction } from '../policy/service';
import { sessionRootHash, sessionRecordHash } from './hashes';
import { sessionLimits, sessionSchema } from './schema';
import type { Session, SessionError, SessionVerification } from './types';

function failure(error: SessionError): SessionVerification {
  return freezeData({ ok: false, authenticated: false, errors: [error] });
}

export function verifySession(text: string): SessionVerification {
  let session: Session;
  try {
    session = sessionSchema.parse(parseBoundedJson(text, sessionLimits));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return failure({ code: /limit|too large/i.test(message) ? 'SIZE' : 'FORMAT', message: 'Session must match the bounded supported format.' });
  }
  let snapshot;
  try {
    snapshot = parsePolicyJson(JSON.stringify(session.policy));
  } catch {
    return failure({ code: 'POLICY', message: 'Bundled policy is invalid.' });
  }
  if (snapshot.policyDigest !== session.policyDigest) {
    return failure({ code: 'POLICY', message: 'Bundled policy digest does not match.' });
  }
  if (session.rootHash !== sessionRootHash(session)) {
    return failure({ code: 'ROOT', message: 'Session identity or policy root does not match.' });
  }
  if (session.recordCount !== session.records.length) {
    return failure({ code: 'SEQUENCE', message: 'Declared record count does not match.' });
  }
  let previousHash = session.rootHash;
  for (let index = 0; index < session.records.length; index += 1) {
    const record = session.records[index]!;
    const sequence = index + 1;
    if (record.sequence !== sequence) {
      return failure({ code: 'SEQUENCE', sequence, message: 'Session sequence is not contiguous.' });
    }
    if (record.previousHash !== previousHash || record.hash !== sessionRecordHash(record)) {
      return failure({ code: 'RECORD', sequence, message: 'Record hash chain does not match.' });
    }
    try {
      const expected = checkAction(snapshot, { expectedPolicyDigest: snapshot.policyDigest, action: record.action });
      if (canonicalize(normalizeJsonValue(expected)) !== canonicalize(normalizeJsonValue(record.result))) {
        return failure({ code: 'REPLAY', sequence, message: 'Recorded decision does not match independent policy replay.' });
      }
    } catch {
      return failure({ code: 'REPLAY', sequence, message: 'Declared action cannot be replayed under the bundled policy.' });
    }
    previousHash = record.hash;
  }
  if (previousHash !== session.terminalHash) {
    return failure({ code: 'TERMINAL', message: 'Terminal hash does not match the final record.' });
  }
  return freezeData({ ok: true, authenticated: false, session });
}

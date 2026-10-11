import type { CodingAction } from '../policy/actions';
import type { Policy } from '../policy/schema';
import type { ActionCheckResult } from '../policy/service';

export interface SessionRecord {
  readonly sequence: number;
  readonly action: CodingAction;
  readonly result: ActionCheckResult;
  readonly previousHash: string;
  readonly hash: string;
}

export interface Session {
  readonly schemaVersion: 1;
  readonly mode: 'advisory';
  readonly executionPerformed: false;
  readonly sessionId: string;
  readonly label: string;
  readonly policy: Policy;
  readonly policyDigest: string;
  readonly rootHash: string;
  readonly records: readonly SessionRecord[];
  readonly recordCount: number;
  readonly terminalHash: string;
}

export interface SessionError {
  readonly code: 'FORMAT' | 'SIZE' | 'POLICY' | 'ROOT' | 'SEQUENCE' | 'RECORD' | 'REPLAY' | 'TERMINAL';
  readonly message: string;
  readonly sequence?: number;
}

export type SessionVerification =
  | { readonly ok: true; readonly authenticated: false; readonly session: Session }
  | { readonly ok: false; readonly authenticated: false; readonly errors: readonly SessionError[] };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface Predicate {
  readonly op: 'eq' | 'exists' | 'absent' | 'contains' | 'setEquals' | 'lte';
  readonly path: string;
  readonly value?: JsonValue;
}

export type ClauseKind = 'MUST' | 'MUST_NOT' | 'MAY' | 'REVOKED' | 'NEEDS_CONFIRMATION' | 'EVIDENCE';
export type Effect = 'READ' | 'DRAFT_WRITE' | 'LOCAL_PERSIST' | 'EXTERNAL_TRANSMIT' | 'PUBLISH' | 'DESTRUCTIVE';

export interface ActionSelector {
  tool?: string;
  operation?: string;
  resource?: string;
  effect?: Effect;
}

export interface SourceRef {
  turnId: string;
  quote: string;
}

export interface Clause {
  id: string;
  kind: ClauseKind;
  statement: string;
  selector?: ActionSelector;
  introducedIn: number;
  source: SourceRef;
  targetClauseIds?: readonly string[];
  revokedSelector?: ActionSelector;
  afterConfirmation?: 'MAY' | 'MUST';
  evidenceRequirement?: {
    forClauseId: string;
    fact: string;
    equals: string | number | boolean;
  };
}

export type IntentDiffOp =
  | { op: 'ADD'; clause: Omit<Clause, 'introducedIn'> }
  | { op: 'REVOKE'; tombstone: Omit<Clause, 'introducedIn'> }
  | { op: 'REPLACE'; targetClauseIds: readonly string[]; replacement: Omit<Clause, 'introducedIn'> }
  | { op: 'NO_CHANGE'; reason: 'DISCUSSION' | 'IRRELEVANT' | 'AMBIGUOUS' };

export interface IntentDiff {
  baseVersion: number;
  turnId: string;
  ops: readonly IntentDiffOp[];
}

export interface ContractVersion {
  version: number;
  parentVersion: number | null;
  turnId: string;
  clauses: readonly Clause[];
  hash: string;
}

export interface ActionProposal {
  id: string;
  stepId: string;
  tool: string;
  operation: string;
  args: Readonly<Record<string, unknown>>;
  effect: Effect;
  resource: string;
  fingerprint: string;
}

export interface GateDecision {
  outcome: 'ALLOW' | 'BLOCK' | 'CONFIRM';
  contractVersion: number;
  actionFingerprint: string;
  matchedClauseIds: readonly string[];
  reasons: readonly string[];
}

export interface ToolObservation {
  actionId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  facts: Readonly<Record<string, string | number | boolean>>;
  evidenceId: string;
}

export interface RunEvent {
  readonly id: string;
  readonly logicalStep: number;
  readonly type: 'TURN_RECEIVED' | 'DIFF_COMPILED' | 'CONTRACT_VERSION_APPENDED' | 'ACTION_PROPOSED' | 'GATE_DECISION' | 'TOOL_OBSERVATION' | 'CLAIM_EVALUATED' | 'FINISH_EVALUATED';
  readonly proposalId?: string;
  readonly outcome?: 'ALLOW' | 'BLOCK' | 'CONFIRM' | 'BYPASS';
  readonly facts?: Readonly<Record<string, JsonPrimitive>>;
}

export interface CompletionReceipt {
  runner: 'standard' | 'mandate';
  contractVersion: number | null;
  claims: readonly { statement: string; evidenceIds: readonly string[]; verified: boolean }[];
  blockedActions: readonly GateDecision[];
  unmetClauseIds: readonly string[];
  exactMandateSuccess: boolean;
}

export type Proposal =
  | { readonly kind: 'ACTION'; readonly afterTurn: string; readonly action: ActionProposal }
  | { readonly kind: 'CLAIM'; readonly afterTurn: string; readonly id: string; readonly text: string; readonly asserts: readonly Predicate[] }
  | { readonly kind: 'FINISH'; readonly afterTurn: string; readonly id: string }
  | { readonly kind: 'ASK_CONFIRMATION'; readonly afterTurn: string; readonly id: string; readonly actionRef: string };

export interface ScenarioTurn {
  readonly id: string;
  readonly text: string;
  readonly canonicalDiff: IntentDiff;
}

export interface ScenarioDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly seed: number;
  readonly initialWorld: Readonly<Record<string, JsonValue>>;
  readonly turns: readonly ScenarioTurn[];
  readonly proposalProgram: {
    readonly main: readonly Proposal[];
    readonly onRejected?: Readonly<Record<string, readonly Proposal[]>>;
  };
  readonly oracle: {
    readonly must: readonly Predicate[];
    readonly evidence: readonly Predicate[];
    readonly standardTerminalWorld: Readonly<Record<string, JsonValue>>;
    readonly mandateTerminalWorld: Readonly<Record<string, JsonValue>>;
    readonly expectedStandardPass: boolean;
    readonly expectedMandatePass: true;
    readonly failureCategory: string;
  };
}

export interface RunTrace {
  readonly scenarioId: string;
  readonly runner: 'standard' | 'mandate';
  readonly scenarioChecksum: string;
  readonly proposalChecksum: string;
  readonly events: readonly RunEvent[];
  readonly terminalWorld: Readonly<Record<string, JsonValue>>;
  readonly receipt: CompletionReceipt;
  readonly traceChecksum: string;
}

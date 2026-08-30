export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface Predicate {
  readonly op: 'eq' | 'exists' | 'absent' | 'contains' | 'setEquals' | 'lte';
  readonly path: string;
  readonly value?: JsonValue;
}

export type ClauseKind = 'MUST' | 'MUST_NOT' | 'MAY' | 'REVOKED' | 'NEEDS_CONFIRMATION' | 'EVIDENCE';
export type CompilerConfidence = 1 | 0.9 | 0.6;
export type Effect = 'READ' | 'DRAFT_WRITE' | 'LOCAL_PERSIST' | 'EXTERNAL_TRANSMIT' | 'PUBLISH' | 'DESTRUCTIVE';

export interface ActionSelector {
  readonly tool?: string;
  readonly operation?: string;
  readonly resource?: string;
  readonly effect?: Effect;
}

export interface SourceRef {
  readonly turnId: string;
  readonly quote: string;
}

export interface Clause {
  readonly id: string;
  readonly kind: ClauseKind;
  readonly statement: string;
  readonly selector?: ActionSelector;
  readonly introducedIn: number;
  readonly source: SourceRef;
  readonly confidence?: CompilerConfidence;
  readonly targetClauseIds?: readonly string[];
  readonly revokedSelector?: ActionSelector;
  readonly afterConfirmation?: 'MAY' | 'MUST';
  readonly evidenceRequirement?: {
    readonly forClauseId: string;
    readonly fact: string;
    readonly equals: string | number | boolean;
  };
}

export type IntentDiffOp =
  | { readonly op: 'ADD'; readonly clause: Omit<Clause, 'introducedIn'> }
  | { readonly op: 'REVOKE'; readonly tombstone: Omit<Clause, 'introducedIn'> }
  | { readonly op: 'REPLACE'; readonly targetClauseIds: readonly string[]; readonly replacement: Omit<Clause, 'introducedIn'> }
  | { readonly op: 'NO_CHANGE'; readonly reason: 'DISCUSSION' | 'IRRELEVANT' | 'AMBIGUOUS' };

export interface IntentDiff {
  readonly baseVersion: number;
  readonly turnId: string;
  readonly source: SourceRef;
  readonly ops: readonly IntentDiffOp[];
}

export interface ContractVersion {
  readonly version: number;
  readonly parentVersion: number | null;
  readonly turnId: string;
  readonly source: SourceRef;
  readonly clauses: readonly Clause[];
  readonly hash: string;
}

export interface ActionProposal {
  readonly id: string;
  readonly stepId: string;
  readonly tool: string;
  readonly operation: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly effect: Effect;
  readonly resource: string;
  readonly fingerprint: string;
}

export interface GateDecision {
  readonly outcome: 'ALLOW' | 'BLOCK' | 'CONFIRM';
  readonly contractVersion: number;
  readonly actionFingerprint: string;
  readonly matchedClauseIds: readonly string[];
  readonly reasons: readonly string[];
}

export interface ToolObservation {
  readonly actionId: string;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  readonly facts: Readonly<Record<string, string | number | boolean>>;
  readonly evidenceId: string;
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
  readonly runner: 'standard' | 'mandate';
  readonly contractVersion: number | null;
  readonly claims: readonly { readonly statement: string; readonly evidenceIds: readonly string[]; readonly verified: boolean }[];
  readonly blockedActions: readonly GateDecision[];
  readonly unmetClauseIds: readonly string[];
  readonly exactMandateSuccess: boolean;
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
  readonly proposalProgram: Readonly<{
    readonly main: readonly Proposal[];
    readonly onRejected?: Readonly<Record<string, readonly Proposal[]>>;
  }>;
  readonly oracle: Readonly<{
    readonly must: readonly Predicate[];
    readonly evidence: readonly Predicate[];
    readonly standardTerminalWorld: Readonly<Record<string, JsonValue>>;
    readonly mandateTerminalWorld: Readonly<Record<string, JsonValue>>;
    readonly expectedStandardPass: boolean;
    readonly expectedMandatePass: true;
    readonly failureCategory: string;
  }>;
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

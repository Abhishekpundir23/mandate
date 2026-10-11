import { codingActionSchema, type CodingAction } from '../policy/actions';
import { diagnosePolicy, type PolicyDiagnostic } from '../policy/diagnostics';
import { freezeData } from '../policy/freeze';
import { parsePolicyJson } from '../policy/parse';
import { checkAction, type ActionCheckResult } from '../policy/service';
import { getPolicyTemplate } from '../policy/templates';
import type { AuthoritySnapshot } from '../policy/types';
import { appendSessionCheck, createSession } from '../sessions/record';
import type { Session } from '../sessions/types';

export interface ActionDraft {
  readonly operation: CodingAction['operation'];
  readonly repositoryId: string;
  readonly path: string;
  readonly treeDigest: string;
  readonly messageDigest: string;
  readonly remoteId: string;
  readonly ref: string;
  readonly commitOid: string;
}

export interface WorkbenchState {
  readonly snapshot: AuthoritySnapshot;
  readonly appliedText: string;
  readonly draftText: string;
  readonly diagnostics: readonly PolicyDiagnostic[];
  readonly notice: string;
  readonly action: ActionDraft;
  readonly result: ActionCheckResult | null;
  readonly actionError: string | null;
  readonly session: Session;
}

export function createWorkbenchState(template = 'draft-only'): WorkbenchState {
  const appliedText = JSON.stringify(getPolicyTemplate(template).policy, null, 2);
  const snapshot = parsePolicyJson(appliedText);
  return freezeData({
    snapshot, appliedText, draftText: appliedText, diagnostics: [], notice: 'Policy ready.',
    action: { operation: 'workspace.readFile', repositoryId: snapshot.repositories[0]?.id ?? '', path: 'README.md',
      treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64), remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'c'.repeat(40) },
    result: null, actionError: null, session: createSession(appliedText, 'workbench-session', 'Workbench checks'),
  });
}

export function editPolicy(state: WorkbenchState, draftText: string): WorkbenchState {
  return freezeData({ ...state, draftText, result: null, actionError: null, diagnostics: [],
    notice: draftText === state.appliedText ? 'Applied policy restored.' : 'Draft changed. Apply a valid policy before checking actions.' });
}

export function resetPolicyDraft(state: WorkbenchState): WorkbenchState {
  return editPolicy(state, state.appliedText);
}

export function loadTemplateDraft(state: WorkbenchState, template: string): WorkbenchState {
  return editPolicy(state, JSON.stringify(getPolicyTemplate(template).policy, null, 2));
}

export function applyPolicy(state: WorkbenchState): WorkbenchState {
  const diagnosis = diagnosePolicy(state.draftText);
  if (!diagnosis.ok) return freezeData({ ...state, diagnostics: diagnosis.diagnostics, result: null,
    actionError: null, notice: 'Draft rejected. The last valid policy remains applied.' });
  const snapshot = diagnosis.snapshot;
  const changed = snapshot.policyDigest !== state.snapshot.policyDigest;
  return freezeData({ ...state, snapshot, appliedText: state.draftText, diagnostics: [], result: null, actionError: null,
    session: changed ? createSession(state.draftText, 'workbench-session', 'Workbench checks') : state.session,
    notice: changed ? 'Policy applied. A new advisory session is ready.' : 'Equivalent policy applied. Recorded checks retained.' });
}

export function editActionField<K extends keyof ActionDraft>(state: WorkbenchState, field: K, value: ActionDraft[K]): WorkbenchState {
  return freezeData({ ...state, action: { ...state.action, [field]: value }, result: null, actionError: null });
}

export function actionFromDraft(draft: ActionDraft): CodingAction {
  const args = draft.operation === 'workspace.readFile' ? { repositoryId: draft.repositoryId, path: draft.path }
    : draft.operation === 'git.commit' ? { repositoryId: draft.repositoryId, treeDigest: draft.treeDigest, messageDigest: draft.messageDigest }
      : { repositoryId: draft.repositoryId, remoteId: draft.remoteId, ref: draft.ref, commitOid: draft.commitOid };
  return codingActionSchema.parse({ operation: draft.operation, args });
}

export function checkWorkbenchAction(state: WorkbenchState): WorkbenchState {
  if (state.draftText !== state.appliedText) return freezeData({ ...state, result: null,
    actionError: 'Apply the current policy draft before checking an action.' });
  try {
    const action = actionFromDraft(state.action);
    const result = checkAction(state.snapshot, { expectedPolicyDigest: state.snapshot.policyDigest, action });
    const session = appendSessionCheck(state.session, action);
    return freezeData({ ...state, result, session, actionError: null });
  } catch {
    return freezeData({ ...state, result: null, actionError: state.session.recordCount >= 500
      ? 'This session has reached its 500-record limit. Start a new session to continue.'
      : 'Enter valid action fields for a configured repository and remote.' });
  }
}

export function resetWorkbenchSession(state: WorkbenchState): WorkbenchState {
  return freezeData({ ...state, result: null, actionError: null,
    session: createSession(state.appliedText, 'workbench-session', 'Workbench checks') });
}

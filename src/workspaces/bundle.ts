import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import { sha256 } from '../policy/sha256';
import { parsePolicyJson } from '../policy/parse';
import { deriveAction } from '../policy/actions';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import type { Session } from '../sessions/types';
import type { CaseSuite } from '../impact/cases';
import { validateWorkspaceEntry } from './entries';
import { workspaceBundleSchema, workspaceContentSchema, workspaceLimits } from './schema';
import type { WorkspaceBundle, WorkspaceEntry, WorkspaceVerification } from './types';
function digest(value: unknown) {
  return sha256(canonicalize(normalizeJsonValue(value)));
}
function validateReferences(entries: readonly WorkspaceEntry[]): void {
  for (const entry of entries) {
    if (new Set(entry.references).size !== entry.references.length)
      throw new Error('REFERENCE_MISMATCH');
    if (entry.kind !== 'SESSION' && entry.kind !== 'CASES') {
      if (entry.references.length !== 0) throw new Error('REFERENCE_MISMATCH');
      continue;
    }
    if (entry.references.length !== 1) throw new Error('REFERENCE_MISMATCH');
    const policy = entries.find((candidate) => candidate.id === entry.references[0]);
    if (policy?.kind !== 'POLICY') throw new Error('REFERENCE_MISMATCH');
    const snapshot = parsePolicyJson(JSON.stringify(policy.payload));
    if (entry.kind === 'SESSION') {
      if ((entry.payload as Session).policyDigest !== snapshot.policyDigest)
        throw new Error('REFERENCE_MISMATCH');
    } else {
      for (const item of (entry.payload as CaseSuite).cases) deriveAction(snapshot, item.action);
    }
  }
}
export function createWorkspace(
  id: string,
  label: string,
  input: readonly WorkspaceEntry[],
): WorkspaceBundle {
  const content = workspaceContentSchema.parse(
    normalizeBoundedJson(
      { schemaVersion: 1, kind: 'authority-workspace', id, label, entries: input },
      workspaceLimits,
    ),
  );
  if (new Set(content.entries.map((entry) => entry.id)).size !== content.entries.length)
    throw new Error('INVALID_ENTRY');
  const entries = content.entries
    .map(validateWorkspaceEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const kind of ['POLICY', 'SESSION', 'CASES', 'TRACE', 'CAMPAIGN'] as const) {
    if (
      entries.filter((entry) => entry.kind === kind).length >
      (kind === 'TRACE' || kind === 'CAMPAIGN' ? 4 : 8)
    )
      throw new Error('INVALID_ENTRY');
  }
  validateReferences(entries);
  const manifestEntries = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    digest: digest(entry),
  }));
  const rootDigest = digest({
    schemaVersion: 1,
    kind: 'authority-workspace',
    id,
    label,
    entries: manifestEntries,
  });
  const bundle = {
    schemaVersion: 1 as const,
    kind: 'authority-workspace' as const,
    id,
    label,
    entries,
    manifest: { algorithm: 'SHA-256' as const, entries: manifestEntries, rootDigest },
  };
  return freezeData(normalizeBoundedJson(bundle, workspaceLimits)) as unknown as WorkspaceBundle;
}
export function verifyWorkspace(text: string): WorkspaceVerification {
  let raw: unknown;
  try {
    raw = parseBoundedJson(text, workspaceLimits);
  } catch {
    return freezeData({ ok: false, authenticated: false, code: 'INVALID_INPUT' });
  }
  const parsed = workspaceBundleSchema.safeParse(raw);
  if (!parsed.success)
    return freezeData({ ok: false, authenticated: false, code: 'INVALID_WORKSPACE' });
  let workspace: WorkspaceBundle;
  try {
    workspace = createWorkspace(parsed.data.id, parsed.data.label, parsed.data.entries);
  } catch (error) {
    return freezeData({
      ok: false,
      authenticated: false,
      code:
        error instanceof Error && error.message === 'REFERENCE_MISMATCH'
          ? 'REFERENCE_MISMATCH'
          : 'INVALID_ENTRY',
    });
  }
  if (
    canonicalize(normalizeJsonValue(workspace.manifest)) !==
    canonicalize(normalizeJsonValue(parsed.data.manifest))
  ) {
    return freezeData({ ok: false, authenticated: false, code: 'MANIFEST_MISMATCH' });
  }
  return freezeData({ ok: true, authenticated: false, workspace });
}
export function serializeWorkspace(workspace: WorkspaceBundle): string {
  const text = canonicalize(normalizeBoundedJson(workspace, workspaceLimits));
  const verified = verifyWorkspace(text);
  if (!verified.ok) throw new Error('Invalid workspace');
  return canonicalize(normalizeJsonValue(verified.workspace));
}
export function validateWorkspace(workspace: WorkspaceBundle): WorkspaceBundle {
  const verified = verifyWorkspace(canonicalize(normalizeBoundedJson(workspace, workspaceLimits)));
  if (!verified.ok) throw new Error('Invalid workspace');
  return verified.workspace;
}

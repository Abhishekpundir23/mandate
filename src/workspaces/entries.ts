import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { parsePolicyJson } from '../policy/parse';
import { verifySession } from '../sessions/verify';
import { parseCaseSuite } from '../impact/cases';
import { verifyTraceBundle } from '../inspection/bundle';
import { parseCampaign } from '../campaigns/schema';
import { freezeData } from '../policy/freeze';
import { workspaceEntrySchema, workspaceLimits } from './schema';
import type { WorkspaceEntry } from './types';
export function validateWorkspaceEntry(input: unknown): WorkspaceEntry {
  const entry = workspaceEntrySchema.parse(normalizeBoundedJson(input, workspaceLimits));
  const text = JSON.stringify(entry.payload);
  let payload: unknown;
  if (entry.kind === 'POLICY') payload = parsePolicyJson(text).document;
  else if (entry.kind === 'SESSION') {
    const verified = verifySession(text); if (!verified.ok) throw new Error('INVALID_ENTRY'); payload = verified.session;
  } else if (entry.kind === 'CASES') payload = parseCaseSuite(text);
  else if (entry.kind === 'TRACE') {
    const verified = verifyTraceBundle(text); if (!verified.ok) throw new Error('INVALID_ENTRY'); payload = verified.bundle;
  } else payload = parseCampaign(text);
  return freezeData({ id: entry.id, label: entry.label, kind: entry.kind, references: entry.references, payload });
}
export function parseWorkspaceEntry(text: string): WorkspaceEntry { return validateWorkspaceEntry(parseBoundedJson(text, workspaceLimits)); }

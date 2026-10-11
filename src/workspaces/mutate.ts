import { idSchema } from '../policy/schema';
import { z } from '../domain/zod';
import { normalizeBoundedJson } from '../policy/json';
import { createWorkspace, validateWorkspace } from './bundle';
import { validateWorkspaceEntry } from './entries';
import type { WorkspaceBundle, WorkspaceEntry } from './types';
export function addWorkspaceEntry(input: WorkspaceBundle, entry: WorkspaceEntry): WorkspaceBundle {
  const workspace = validateWorkspace(input);
  const validated = validateWorkspaceEntry(entry);
  return createWorkspace(workspace.id, workspace.label, [...workspace.entries, validated]);
}
export function replaceWorkspaceEntry(
  input: WorkspaceBundle,
  entry: WorkspaceEntry,
): WorkspaceBundle {
  const workspace = validateWorkspace(input);
  const validated = validateWorkspaceEntry(entry);
  if (!workspace.entries.some((item) => item.id === validated.id))
    throw new Error('Unknown workspace entry');
  return createWorkspace(
    workspace.id,
    workspace.label,
    workspace.entries.map((item) => (item.id === validated.id ? validated : item)),
  );
}
export function removeWorkspaceEntry(
  input: WorkspaceBundle,
  id: string,
  options: { readonly cascade?: boolean } = {},
): WorkspaceBundle {
  const workspace = validateWorkspace(input);
  const validatedOptions = z
    .strictObject({ cascade: z.boolean().optional() })
    .parse(normalizeBoundedJson(options, { bytes: 1024, depth: 4, nodes: 10 }));
  if (!workspace.entries.some((entry) => entry.id === id))
    throw new Error('Unknown workspace entry');
  const removed = new Set([id]);
  for (const entry of workspace.entries) {
    if (entry.references.includes(id)) {
      if (!validatedOptions.cascade) throw new Error('Workspace entry is referenced');
      removed.add(entry.id);
    }
  }
  return createWorkspace(
    workspace.id,
    workspace.label,
    workspace.entries.filter((entry) => !removed.has(entry.id)),
  );
}
export function renameWorkspaceEntry(
  input: WorkspaceBundle,
  id: string,
  newId: string,
): WorkspaceBundle {
  const workspace = validateWorkspace(input);
  const validatedId = idSchema.parse(newId);
  if (
    !workspace.entries.some((entry) => entry.id === id) ||
    workspace.entries.some((entry) => entry.id === validatedId && entry.id !== id)
  )
    throw new Error('Invalid workspace rename');
  return createWorkspace(
    workspace.id,
    workspace.label,
    workspace.entries.map((entry) => ({
      ...entry,
      id: entry.id === id ? validatedId : entry.id,
      references: entry.references.map((reference) => (reference === id ? validatedId : reference)),
    })),
  );
}

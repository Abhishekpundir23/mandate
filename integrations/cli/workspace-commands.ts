import { parseBoundedJson } from '../../src/policy/json';
import type { CliCommand } from './args';
import { positiveVersion } from './args';
import type { CommandResult } from './commands';
import { readBoundedFile } from './io';
import { createWorkspace, serializeWorkspace, verifyWorkspace } from '../../src/workspaces/bundle';
import { workspaceLimits } from '../../src/workspaces/schema';
import { parseWorkspaceEntry } from '../../src/workspaces/entries';
import {
  addWorkspaceEntry,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
  replaceWorkspaceEntry,
} from '../../src/workspaces/mutate';
import {
  queryWorkspace,
  redactWorkspace,
  summarizeWorkspace,
} from '../../src/workspaces/inventory';
import type { WorkspaceEntry } from '../../src/workspaces/types';
export async function executeWorkspaceCommand(input: CliCommand): Promise<CommandResult> {
  const options = input.options;
  if (input.command === 'create') {
    const entries: WorkspaceEntry[] = [
      {
        id: 'policy',
        label: 'Policy',
        kind: 'POLICY',
        references: [],
        payload: parseBoundedJson(await readBoundedFile(options.policy!, 256 * 1024), {
          bytes: 256 * 1024,
          depth: 32,
          nodes: 20000,
        }),
      },
    ];
    for (const [option, kind, bytes] of [
      ['session', 'SESSION', 1024 * 1024],
      ['cases', 'CASES', 256 * 1024],
      ['trace', 'TRACE', 4 * 1024 * 1024],
      ['campaign', 'CAMPAIGN', 2 * 1024 * 1024],
    ] as const) {
      if (options[option] !== undefined)
        entries.push({
          id: option,
          label: option,
          kind,
          references: kind === 'SESSION' || kind === 'CASES' ? ['policy'] : [],
          payload: parseBoundedJson(await readBoundedFile(options[option], bytes), {
            bytes,
            depth: 48,
            nodes: 500000,
          }),
        });
    }
    const workspace = createWorkspace(options['workspace-id']!, options.label ?? '', entries);
    return { code: 0, value: workspace, json: serializeWorkspace(workspace) };
  }
  const verified = verifyWorkspace(
    await readBoundedFile(options.workspace!, workspaceLimits.bytes),
  );
  if (input.command === 'verify')
    return {
      code: verified.ok ? 0 : 5,
      value: verified.ok
        ? {
            valid: true,
            authenticated: false,
            rootDigest: verified.workspace.manifest.rootDigest,
            entryCount: verified.workspace.entries.length,
          }
        : { valid: false, authenticated: false, code: verified.code },
    };
  if (!verified.ok) throw new Error('INVALID_WORKSPACE');
  const workspace = verified.workspace;
  if (input.command === 'inspect') {
    const query = {
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.search === undefined ? {} : { text: options.search }),
      ...(options.page === undefined ? {} : { page: positiveVersion(options.page) }),
      ...(options['page-size'] === undefined
        ? {}
        : { pageSize: positiveVersion(options['page-size']) }),
    };
    const inventory = queryWorkspace(workspace, query);
    return {
      code: 0,
      value:
        options.redacted === 'true'
          ? redactWorkspace(workspace, query)
          : {
              authenticated: false,
              summary: summarizeWorkspace(workspace),
              rootDigest: workspace.manifest.rootDigest,
              inventory: {
                ...inventory,
                items: inventory.items.map(({ id, label, kind, references }) => ({
                  id,
                  label,
                  kind,
                  references,
                })),
              },
            },
    };
  }
  const next =
    input.command === 'add' || input.command === 'replace'
      ? (input.command === 'add' ? addWorkspaceEntry : replaceWorkspaceEntry)(
          workspace,
          parseWorkspaceEntry(await readBoundedFile(options.entry!, workspaceLimits.bytes)),
        )
      : input.command === 'remove'
        ? removeWorkspaceEntry(workspace, options['entry-id']!, {
            cascade: options.cascade === 'true',
          })
        : renameWorkspaceEntry(workspace, options['entry-id']!, options['new-id']!);
  return { code: 0, value: next, json: serializeWorkspace(next) };
}

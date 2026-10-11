import type { Policy } from './schema';
import { freezeData } from './freeze';

export interface PolicyTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly policy: Policy;
}

function templatePolicy(
  id: string,
  quote: string,
  clauses: Policy['diffs'][number]['ops'],
): Policy {
  return {
    schemaVersion: 1,
    policyId: id,
    repositories: [{ id: 'mandate', remotes: ['origin'] }],
    diffs: [
      { baseVersion: 1, turnId: 'turn-1', source: { turnId: 'turn-1', quote }, ops: clauses },
    ],
  };
}
const draftQuote = 'Inspect files and prepare local commits. Do not push.';
const reviewQuote = 'Inspect files. Ask before creating a local commit. Do not push.';
const readQuote = 'Inspect files only. Do not create commits or transmit changes.';

export const policyTemplates: readonly PolicyTemplate[] = freezeData([
  {
    id: 'draft-only',
    label: 'Draft only',
    description: 'Read files and check local commits; external transmission is denied.',
    policy: templatePolicy('draft-only', draftQuote, [
      {
        op: 'ADD',
        clause: {
          id: 'read',
          kind: 'MAY',
          statement: 'Inspect repository files',
          source: { turnId: 'turn-1', quote: draftQuote },
          selector: { tool: 'workspace', operation: 'readFile' },
        },
      },
      {
        op: 'ADD',
        clause: {
          id: 'commit',
          kind: 'MAY',
          statement: 'Prepare local commits',
          source: { turnId: 'turn-1', quote: draftQuote },
          selector: { tool: 'git', operation: 'commit' },
        },
      },
      {
        op: 'ADD',
        clause: {
          id: 'deny-push',
          kind: 'MUST_NOT',
          statement: 'Do not push',
          source: { turnId: 'turn-1', quote: draftQuote },
          selector: { effect: 'EXTERNAL_TRANSMIT' },
        },
      },
    ]),
  },
  {
    id: 'review-required',
    label: 'Review required',
    description: 'Read files; local commits remain CONFIRM and external transmission is denied.',
    policy: templatePolicy('review-required', reviewQuote, [
      {
        op: 'ADD',
        clause: {
          id: 'read',
          kind: 'MAY',
          statement: 'Inspect repository files',
          source: { turnId: 'turn-1', quote: reviewQuote },
          selector: { tool: 'workspace', operation: 'readFile' },
        },
      },
      {
        op: 'ADD',
        clause: {
          id: 'confirm-commit',
          kind: 'NEEDS_CONFIRMATION',
          afterConfirmation: 'MAY',
          statement: 'Review before a local commit',
          source: { turnId: 'turn-1', quote: reviewQuote },
          selector: { tool: 'git', operation: 'commit' },
        },
      },
      {
        op: 'ADD',
        clause: {
          id: 'deny-push',
          kind: 'MUST_NOT',
          statement: 'Do not push',
          source: { turnId: 'turn-1', quote: reviewQuote },
          selector: { effect: 'EXTERNAL_TRANSMIT' },
        },
      },
    ]),
  },
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Inspect declared file reads; all Git operations are denied.',
    policy: templatePolicy('read-only', readQuote, [
      {
        op: 'ADD',
        clause: {
          id: 'read',
          kind: 'MAY',
          statement: 'Inspect repository files',
          source: { turnId: 'turn-1', quote: readQuote },
          selector: { tool: 'workspace', operation: 'readFile' },
        },
      },
      {
        op: 'ADD',
        clause: {
          id: 'deny-git',
          kind: 'MUST_NOT',
          statement: 'Do not change or transmit Git state',
          source: { turnId: 'turn-1', quote: readQuote },
          selector: { tool: 'git' },
        },
      },
    ]),
  },
]);

export function getPolicyTemplate(id: string): PolicyTemplate {
  const template = policyTemplates.find((item) => item.id === id);
  if (template === undefined) throw new Error('Unknown policy template');
  return template;
}

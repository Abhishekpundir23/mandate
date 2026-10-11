import type { CodingAction } from '../policy/actions';
import { freezeData } from '../policy/freeze';
import { normalizeJsonValue } from '../domain/canonical';
import type { Policy } from '../policy/schema';

type ClauseInput = Omit<Policy['diffs'][number]['ops'][number] & { op: 'ADD' }, 'op'>['clause'];
type Selector = NonNullable<ClauseInput['selector']>;
type ClauseDraft = Omit<ClauseInput, 'source'>;
type Diff = Policy['diffs'][number];
export interface PolicyExperiment {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly policy: Policy;
  readonly steps: readonly {
    readonly version: number;
    readonly action: CodingAction;
    readonly expected: 'ALLOW' | 'BLOCK' | 'CONFIRM';
    readonly why: string;
  }[];
}

const read: Selector = { tool: 'workspace', operation: 'readFile' };
const commit: Selector = { tool: 'git', operation: 'commit' };
const push: Selector = { tool: 'git', operation: 'push' };
const readAction = (path = 'README.md', repositoryId = 'mandate'): CodingAction => ({
  operation: 'workspace.readFile', args: { repositoryId, path },
});
const commitAction: CodingAction = { operation: 'git.commit', args: {
  repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64),
} };
const pushAction = (remoteId = 'origin', ref = 'refs/heads/main'): CodingAction => ({
  operation: 'git.push', args: { repositoryId: 'mandate', remoteId, ref, commitOid: 'c'.repeat(40) },
});
const grant = (id: string, selector: Selector, kind: 'MAY' | 'MUST' = 'MAY'): ClauseDraft => ({
  id, kind, statement: 'Authorize ' + id, selector,
});
const deny = (id: string, selector: Selector): ClauseDraft => ({
  id, kind: 'MUST_NOT', statement: 'Deny ' + id, selector,
});
const confirm = (id: string, selector: Selector): ClauseDraft => ({
  id, kind: 'NEEDS_CONFIRMATION', statement: 'Review ' + id, selector, afterConfirmation: 'MAY',
});
const revoke = (id: string, targetClauseIds: string[], revokedSelector?: Selector): ClauseDraft => ({
  id, kind: 'REVOKED', statement: 'Withdraw ' + id, targetClauseIds,
  ...(revokedSelector === undefined ? {} : { revokedSelector }),
});
const evidence = (id: string, forClauseId: string): ClauseDraft => ({
  id, kind: 'EVIDENCE', statement: 'Require evidence for ' + forClauseId,
  evidenceRequirement: { forClauseId, fact: 'read', equals: true },
});
function turn(index: number, quote: string, clauses: readonly ClauseDraft[]): Diff {
  const turnId = 'turn-' + index;
  const source = { turnId, quote };
  return { baseVersion: index, turnId, source,
    ops: clauses.map((clause) => clause.kind === 'REVOKED'
      ? { op: 'REVOKE' as const, tombstone: { ...clause, source } }
      : { op: 'ADD' as const, clause: { ...clause, source } }) };
}
function policy(id: string, diffs: Diff[]): Policy {
  return { schemaVersion: 1, policyId: id,
    repositories: [{ id: 'mandate', remotes: ['origin', 'backup'] }, { id: 'other', remotes: ['origin'] }], diffs };
}
const step = (version: number, action: CodingAction, expected: 'ALLOW' | 'BLOCK' | 'CONFIRM', why: string) =>
  ({ version, action, expected, why });
function experiment(id: string, title: string, category: string, description: string, diffs: Diff[],
  steps: PolicyExperiment['steps']): PolicyExperiment {
  return { id, title, category, description, policy: policy(id, diffs), steps };
}
const file = (path: string): Selector => ({ ...read, resource: 'repository:mandate/file:' + path });
const remote = (remoteId: string, ref = 'refs/heads/main'): Selector => ({
  ...push, resource: 'repository:mandate/remote:' + remoteId + '/ref:' + ref,
});

/** Expectations are maintained examples of engine semantics, not generated from decisions. */
const catalog: readonly PolicyExperiment[] = [
  experiment('grant-then-revoke', 'Grant, then withdraw', 'history',
    'An append-only revocation changes the next check while preserving the earlier version.', [
      turn(1, 'Allow local commits.', [grant('commit', commit)]),
      turn(2, 'Withdraw local commits.', [revoke('withdraw', ['commit'], commit)]),
    ], [
      step(2, commitAction, 'ALLOW', 'The grant is active in version 2.'),
      step(3, commitAction, 'BLOCK', 'The later tombstone denies the same operation.'),
    ]),
  experiment('denial-wins', 'Denial wins conflicting authority', 'precedence',
    'Neither an obligation nor a request to confirm can override a matching prohibition.', [
      turn(1, 'Prepare commits, but do not commit; review first.', [
        grant('must-commit', commit, 'MUST'), deny('deny-commit', commit), confirm('review-commit', commit),
      ]),
    ], [step(2, commitAction, 'BLOCK', 'The matching MUST_NOT takes precedence.')]),
  experiment('retire-tombstone', 'Explicitly retire a denial', 'revocation',
    'A fresh grant is usable only after the active denial has been explicitly retired.', [
      turn(1, 'Allow local commits.', [grant('original', commit)]),
      turn(2, 'Withdraw local commits.', [revoke('withdraw', ['original'], commit)]),
      turn(3, 'Retire the withdrawal and issue a fresh grant.', [revoke('retire', ['withdraw']), grant('fresh', commit)]),
    ], [
      step(2, commitAction, 'ALLOW', 'Initial grant.'),
      step(3, commitAction, 'BLOCK', 'Active denial tombstone.'),
      step(4, commitAction, 'ALLOW', 'Fresh grant and retired denial.'),
    ]),
  experiment('repository-isolation', 'Repository isolation', 'resource',
    'A repository-specific commit grant does not authorize another configured repository.', [
      turn(1, 'Allow commits in mandate.', [grant('mandate-only', { ...commit, resource: 'repository:mandate' })]),
    ], [
      step(2, commitAction, 'ALLOW', 'The exact repository matches.'),
      step(2, { ...commitAction, args: { ...commitAction.args, repositoryId: 'other' } }, 'BLOCK', 'No grant names other.'),
    ]),
  experiment('remote-isolation', 'Remote isolation', 'resource',
    'A push grant is scoped to one configured remote and branch.', [
      turn(1, 'Allow origin main only.', [grant('origin-main', remote('origin'))]),
    ], [
      step(2, pushAction(), 'ALLOW', 'Exact origin/main target.'),
      step(2, pushAction('backup'), 'BLOCK', 'Backup is configured but not authorized.'),
    ]),
  experiment('path-isolation', 'File path isolation', 'resource',
    'File selectors use exact canonical paths, with no implicit directory wildcard.', [
      turn(1, 'Read README only.', [grant('readme', file('README.md'))]),
    ], [
      step(2, readAction(), 'ALLOW', 'Exact declared file.'),
      step(2, readAction('README.md/child'), 'BLOCK', 'A suffix is a different resource.'),
    ]),
  experiment('branch-isolation', 'Branch isolation', 'resource',
    'A main-branch grant does not apply to a similarly named branch.', [
      turn(1, 'Push main only.', [grant('main', remote('origin'))]),
    ], [
      step(2, pushAction(), 'ALLOW', 'Main matches.'),
      step(2, pushAction('origin', 'refs/heads/main-copy'), 'BLOCK', 'main-copy is a different target.'),
    ]),
  experiment('default-deny', 'No implicit permission', 'defaults',
    'Configured capabilities remain denied until authority explicitly grants them.', [], [
      step(1, readAction(), 'BLOCK', 'Repository configuration is not permission.'),
      step(1, commitAction, 'BLOCK', 'A valid capability is not a grant.'),
      step(1, pushAction(), 'BLOCK', 'External transmission has no authority.'),
    ]),
  experiment('read-only', 'Read-only policy', 'defaults',
    'Allowing inspection does not imply authority to persist or transmit changes.', [
      turn(1, 'Inspect files only.', [grant('read', read)]),
    ], [
      step(2, readAction(), 'ALLOW', 'Read grant matches.'),
      step(2, commitAction, 'BLOCK', 'No persistence grant.'),
      step(2, pushAction(), 'BLOCK', 'No transmission grant.'),
    ]),
  experiment('review-required', 'Advisory confirmation remains pending', 'confirmation',
    'The adapter reports a confirmation requirement without issuing a token.', [
      turn(1, 'Review each local commit.', [confirm('review', commit)]),
    ], [step(2, commitAction, 'CONFIRM', 'No confirmation token is issued by this service.')]),
  experiment('confirmation-overrides-grant', 'Confirmation constrains a grant', 'confirmation',
    'A matching confirmation requirement remains binding even when MAY is present.', [
      turn(1, 'Allow commits after review.', [grant('commit', commit), confirm('review', commit)]),
    ], [step(2, commitAction, 'CONFIRM', 'Permission does not bypass the confirmation requirement.')]),
  experiment('confirmation-overrides-must', 'An obligation still needs confirmation', 'confirmation',
    'A MUST clause cannot synthesize human confirmation.', [
      turn(1, 'Prepare a required commit after review.', [grant('commit', commit, 'MUST'), confirm('review', commit)]),
    ], [step(2, commitAction, 'CONFIRM', 'Required work still waits for the matching review.')]),
  experiment('private-file-denial', 'Narrow denial inside broad read grant', 'precedence',
    'An exact private-file denial constrains a broad inspection grant.', [
      turn(1, 'Read files except secrets.', [grant('read', read), deny('secrets', file('secrets.env'))]),
    ], [
      step(2, readAction(), 'ALLOW', 'Public file has no matching denial.'),
      step(2, readAction('secrets.env'), 'BLOCK', 'Exact private resource is denied.'),
    ]),
  experiment('effect-denial', 'Deny external transmission by effect', 'precedence',
    'An effect-level denial covers all configured push targets.', [
      turn(1, 'Allow git work but never transmit.', [grant('git', { tool: 'git' }), deny('transmit', { effect: 'EXTERNAL_TRANSMIT' })]),
    ], [
      step(2, commitAction, 'ALLOW', 'Local persistence is not external transmission.'),
      step(2, pushAction(), 'BLOCK', 'Origin push transmits.'),
      step(2, pushAction('backup'), 'BLOCK', 'Backup push also transmits.'),
    ]),
  experiment('unrelated-denial', 'Unrelated denial stays scoped', 'precedence',
    'A push denial does not suppress an independent read grant.', [
      turn(1, 'Inspect files and do not push.', [grant('read', read), deny('push', push)]),
    ], [
      step(2, readAction(), 'ALLOW', 'No denial matches a file read.'),
      step(2, pushAction(), 'BLOCK', 'The denial matches a push.'),
    ]),
  experiment('selector-revocation', 'Withdraw by selector', 'revocation',
    'A revocation can deny an operation without naming a previous clause.', [
      turn(1, 'Allow all git work.', [grant('git', { tool: 'git' })]),
      turn(2, 'Withdraw pushing only.', [revoke('withdraw-push', [], push)]),
    ], [
      step(3, commitAction, 'ALLOW', 'The narrower revocation does not match commits.'),
      step(3, pushAction(), 'BLOCK', 'The active revoked selector matches pushing.'),
    ]),
  experiment('target-only-revocation', 'Withdraw a grant by ID', 'revocation',
    'Target-only tombstones inherit the denied action scope from the referenced clause.', [
      turn(1, 'Allow local commits.', [grant('commit', commit)]),
      turn(2, 'Withdraw that grant.', [revoke('withdraw', ['commit'])]),
    ], [step(3, commitAction, 'BLOCK', 'Targeted grant is retired and its scope is denied.')]),
  experiment('discussion-no-change', 'Discussion preserves authority', 'history',
    'A NO_CHANGE turn adds provenance without inventing permissions.', [
      turn(1, 'Allow reads.', [grant('read', read)]),
      { baseVersion: 2, turnId: 'turn-2', source: { turnId: 'turn-2', quote: 'Discuss future publishing.' },
        ops: [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }] },
    ], [
      step(3, readAction(), 'ALLOW', 'Prior read grant remains active.'),
      step(3, pushAction(), 'BLOCK', 'Discussion added no push grant.'),
    ]),
  experiment('evidence-is-not-grant', 'Evidence requirements do not authorize actions', 'evidence',
    'Evidence linked to a denied clause cannot turn it into permission.', [
      turn(1, 'Do not read, and retain evidence of the restriction.', [deny('read', read), evidence('proof', 'read')]),
    ], [step(2, readAction(), 'BLOCK', 'EVIDENCE describes proof requirements, not permission.')]),
  experiment('same-diff-evidence-first', 'Atomic evidence before its grant', 'evidence',
    'Same-diff evidence references are resolved against the completed version.', [
      turn(1, 'Read files with evidence.', [evidence('proof', 'read'), grant('read', read, 'MUST')]),
    ], [step(2, readAction(), 'ALLOW', 'The later entry in this atomic diff exists in the resulting version.')]),
  experiment('same-diff-grant-first', 'Atomic grant before its evidence', 'evidence',
    'Reordering a same-diff grant and evidence requirement keeps the action decision.', [
      turn(1, 'Read files with evidence.', [grant('read', read, 'MUST'), evidence('proof', 'read')]),
    ], [step(2, readAction(), 'ALLOW', 'Equivalent resulting authority.')]),
  experiment('unicode-file', 'Canonical Unicode file paths', 'normalization',
    'An NFC file path is an exact resource and does not match an ASCII approximation.', [
      turn(1, 'Read the résumé file.', [grant('resume', file('résumé.md'))]),
    ], [
      step(2, readAction('résumé.md'), 'ALLOW', 'NFC target matches.'),
      step(2, readAction('resume.md'), 'BLOCK', 'ASCII spelling is a separate resource.'),
    ]),
  experiment('case-sensitive-path', 'Case-sensitive resource identity', 'normalization',
    'The advisory model does not infer a host filesystem case-folding rule.', [
      turn(1, 'Read README.md only.', [grant('readme', file('README.md'))]),
    ], [
      step(2, readAction(), 'ALLOW', 'Exact spelling.'),
      step(2, readAction('readme.md'), 'BLOCK', 'Different case is a different declaration.'),
    ]),
  experiment('broad-git-grant', 'Tool-level grant includes supported Git operations', 'selector',
    'A broad tool selector intentionally covers both local persistence and transmission.', [
      turn(1, 'Allow all supported git work.', [grant('git', { tool: 'git' })]),
    ], [
      step(2, commitAction, 'ALLOW', 'Git commit matches the tool selector.'),
      step(2, pushAction(), 'ALLOW', 'Git push also matches; broad grants deserve review.'),
      step(2, readAction(), 'BLOCK', 'Workspace reads are a different tool.'),
    ]),
  experiment('local-effect-grant', 'Persistence effect grant', 'selector',
    'An effect selector grants only supported operations with that exact effect.', [
      turn(1, 'Allow local persistence.', [grant('local', { effect: 'LOCAL_PERSIST' })]),
    ], [
      step(2, commitAction, 'ALLOW', 'Commit has LOCAL_PERSIST.'),
      step(2, pushAction(), 'BLOCK', 'Push has EXTERNAL_TRANSMIT.'),
    ]),
  experiment('duplicate-grants', 'Overlapping grants retain one decision', 'selector',
    'Redundant authority clauses do not imply multiple executions.', [
      turn(1, 'Read files under two grants.', [grant('read-a', read), grant('read-b', read)]),
    ], [step(2, readAction(), 'ALLOW', 'Both grants authorize the same declared action once.')]),
  experiment('resource-replacement', 'Replace a grant with a different resource', 'replacement',
    'Replacement retains a denial for the old target and grants the new exact resource.', [
      turn(1, 'Read README.md.', [grant('old', file('README.md'))]),
      { baseVersion: 2, turnId: 'turn-2', source: { turnId: 'turn-2', quote: 'Read CHANGELOG.md instead.' }, ops: [
        { op: 'REPLACE', targetClauseIds: ['old'], replacement: { ...grant('new', file('CHANGELOG.md')),
          source: { turnId: 'turn-2', quote: 'Read CHANGELOG.md instead.' } } },
      ] },
    ], [
      step(3, readAction('CHANGELOG.md'), 'ALLOW', 'New resource is granted.'),
      step(3, readAction(), 'BLOCK', 'Old resource has a replacement tombstone.'),
    ]),
  experiment('same-selector-replacement', 'Same-selector replacement keeps a denial', 'replacement',
    'Replacing a grant does not remove the permanent denial emitted for its old selector.', [
      turn(1, 'Allow commits.', [grant('old', commit)]),
      { baseVersion: 2, turnId: 'turn-2', source: { turnId: 'turn-2', quote: 'Restate the commit grant.' }, ops: [
        { op: 'REPLACE', targetClauseIds: ['old'], replacement: { ...grant('new', commit),
          source: { turnId: 'turn-2', quote: 'Restate the commit grant.' } } },
      ] },
    ], [
      step(2, commitAction, 'ALLOW', 'Original grant is active.'),
      step(3, commitAction, 'BLOCK', 'Replacement tombstone matches the restated selector.'),
    ]),
];

// Expand shared authoring constants into owned JSON trees at the public boundary.
export const policyExperiments: readonly PolicyExperiment[] = freezeData(normalizeJsonValue(catalog)) as unknown as readonly PolicyExperiment[];

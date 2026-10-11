import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import type { ActionSelector, IntentDiff } from '../domain/types';
import { appendVersion, createLedger } from '../mandate/ledger';
import { policySchema, type Policy } from './schema';
import { freezeData } from './freeze';
import { parseBoundedJson, policyJsonLimits } from './json';
import { sha256 } from './sha256';
import { utf8Length } from './utf8';
import type { AuthoritySnapshot } from './types';

type ParsedSelector = { readonly [K in keyof ActionSelector]?: ActionSelector[K] | undefined };

function validateSelector(
  selector: ParsedSelector | undefined,
  repositories: Policy['repositories'],
): void {
  if (selector === undefined) return;
  const candidates = [
    { tool: 'workspace', operation: 'readFile', effect: 'READ' },
    { tool: 'git', operation: 'commit', effect: 'LOCAL_PERSIST' },
    { tool: 'git', operation: 'push', effect: 'EXTERNAL_TRANSMIT' },
  ].filter(
    (c) =>
      (selector.tool === undefined || selector.tool === c.tool) &&
      (selector.operation === undefined || selector.operation === c.operation) &&
      (selector.effect === undefined || selector.effect === c.effect),
  );
  if (candidates.length === 0) throw new Error('Inconsistent selector');
  if (selector.resource !== undefined) {
    const resource = selector.resource;
    if (resource !== resource.trim() || resource !== resource.normalize('NFC'))
      throw new Error('Noncanonical resource');
    const matches = repositories.some(
      ({ id, remotes }) =>
        (candidates.some((c) => c.operation === 'commit') && resource === 'repository:' + id) ||
        (candidates.some((c) => c.operation === 'readFile') &&
          resource.startsWith('repository:' + id + '/file:') &&
          validPath(resource.slice(('repository:' + id + '/file:').length))) ||
        (candidates.some((c) => c.operation === 'push') &&
          remotes.some((remote) => {
            const prefix = 'repository:' + id + '/remote:' + remote + '/ref:';
            return resource.startsWith(prefix) && validRef(resource.slice(prefix.length));
          })),
    );
    if (!matches) throw new Error('Unsupported resource');
  }
}

export function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    path === path.normalize('NFC') &&
    path === path.trim() &&
    !/[\\\p{Cc}]/u.test(path) &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

export function validRef(ref: string): boolean {
  return (
    ref.startsWith('refs/heads/') &&
    ref.length > 'refs/heads/'.length &&
    !/[\\\p{Cc} ~^:?*[]/u.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('@{') &&
    ref
      .split('/')
      .every(
        (part) =>
          part.length > 0 &&
          !part.startsWith('.') &&
          !part.endsWith('.') &&
          !part.endsWith('.lock'),
      ) &&
    ref === ref.normalize('NFC') &&
    ref === ref.trim()
  );
}

export function parsePolicyJson(text: string): AuthoritySnapshot {
  if (utf8Length(text) > policyJsonLimits.bytes) throw new Error('Policy too large');
  const policy = policySchema.parse(parseBoundedJson(text, policyJsonLimits));
  const ids = policy.repositories.map((r) => r.id);
  if (
    new Set(ids).size !== ids.length ||
    policy.repositories.some((r) => new Set(r.remotes).size !== r.remotes.length)
  ) {
    throw new Error('Duplicate repository or remote');
  }
  let versions = createLedger([], 'policy:root');
  for (const diff of policy.diffs) {
    const latest = versions.at(-1)!;
    const knownIds = new Set(latest.clauses.map((c) => c.id));
    const newIds: string[] = [];
    const evidenceTargets: string[] = [];
    for (const op of diff.ops) {
      if (op.op === 'NO_CHANGE') continue;
      const clause =
        op.op === 'ADD' ? op.clause : op.op === 'REPLACE' ? op.replacement : op.tombstone;
      if (clause.source.turnId !== diff.turnId || clause.source.quote !== diff.source.quote)
        throw new Error('Clause provenance mismatch');
      if (op.op === 'REVOKE' ? clause.kind !== 'REVOKED' : clause.kind === 'REVOKED')
        throw new Error('Invalid revocation shape');
      if (
        clause.kind === 'NEEDS_CONFIRMATION'
          ? clause.afterConfirmation === undefined
          : clause.afterConfirmation !== undefined
      )
        throw new Error('Invalid confirmation shape');
      if (
        clause.kind === 'EVIDENCE'
          ? clause.evidenceRequirement === undefined
          : clause.evidenceRequirement !== undefined
      )
        throw new Error('Invalid evidence shape');
      if (clause.kind !== 'EVIDENCE' && clause.kind !== 'REVOKED' && clause.selector === undefined)
        throw new Error('Missing selector');
      if (
        clause.kind !== 'REVOKED' &&
        (clause.targetClauseIds !== undefined || clause.revokedSelector !== undefined)
      )
        throw new Error('Invalid target shape');
      if (clause.kind === 'REVOKED' && clause.selector !== undefined)
        throw new Error('Revocation uses revokedSelector');
      validateSelector(clause.selector, policy.repositories);
      validateSelector(clause.revokedSelector, policy.repositories);
      const targets = op.op === 'REPLACE' ? op.targetClauseIds : (clause.targetClauseIds ?? []);
      if (new Set(targets).size !== targets.length || targets.some((id) => !knownIds.has(id)))
        throw new Error('Invalid targets');
      if (clause.kind === 'REVOKED' && targets.length === 0 && clause.revokedSelector === undefined)
        throw new Error('Empty revocation');
      if (clause.evidenceRequirement !== undefined)
        evidenceTargets.push(clause.evidenceRequirement.forClauseId);
      newIds.push(clause.id);
      if (op.op === 'REPLACE') for (const id of targets) newIds.push(diff.turnId + ':revoke:' + id);
    }
    if (new Set(newIds).size !== newIds.length || newIds.some((id) => knownIds.has(id)))
      throw new Error('Duplicate clause ID');
    // Evidence describes the resulting version, including grants in this atomic diff.
    const resultingIds = new Set([...knownIds, ...newIds]);
    if (evidenceTargets.some((id) => !resultingIds.has(id)))
      throw new Error('Invalid evidence target');
    if (latest.clauses.length + newIds.length > 500) throw new Error('Too many clauses');
    // Strict JSON parsing and the checks above establish the domain invariants;
    // Zod's optional-property types also include undefined under exactOptionalPropertyTypes.
    versions = appendVersion(versions, diff as unknown as IntentDiff);
  }
  const policyDigest = sha256(canonicalize(normalizeJsonValue(policy)));
  return freezeData({
    document: policy,
    policyId: policy.policyId,
    policyDigest,
    repositories: policy.repositories,
    versions,
    current: versions.at(-1)!,
  });
}

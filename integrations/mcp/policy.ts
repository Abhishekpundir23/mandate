import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { canonicalize, normalizeJsonValue } from '../../src/domain/canonical';
import type { ActionSelector, ContractVersion, IntentDiff } from '../../src/domain/types';
import { appendVersion, createLedger } from '../../src/mandate/ledger';
import { policySchema, type Policy } from './policy-schema';

export interface AuthoritySnapshot {
  readonly policyId: string;
  readonly policyDigest: string;
  readonly repositories: Policy['repositories'];
  readonly versions: readonly ContractVersion[];
  readonly current: ContractVersion;
}
const POLICY_BYTES = 256 * 1024;

export function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

type ParsedSelector = { readonly [K in keyof ActionSelector]?: ActionSelector[K] | undefined };

function validateSelector(selector: ParsedSelector | undefined, repositories: Policy['repositories']): void {
  if (selector === undefined) return;
  const candidates = [
    { tool: 'workspace', operation: 'readFile', effect: 'READ' },
    { tool: 'git', operation: 'commit', effect: 'LOCAL_PERSIST' },
    { tool: 'git', operation: 'push', effect: 'EXTERNAL_TRANSMIT' },
  ].filter((c) => (selector.tool === undefined || selector.tool === c.tool)
    && (selector.operation === undefined || selector.operation === c.operation)
    && (selector.effect === undefined || selector.effect === c.effect));
  if (candidates.length === 0) throw new Error('Inconsistent selector');
  if (selector.resource !== undefined) {
    const resource = selector.resource;
    if (resource !== resource.trim() || resource !== resource.normalize('NFC')) throw new Error('Noncanonical resource');
    const matches = repositories.some(({ id, remotes }) =>
      (candidates.some((c) => c.operation === 'commit') && resource === 'repository:' + id)
      || (candidates.some((c) => c.operation === 'readFile') && resource.startsWith('repository:' + id + '/file:')
        && validPath(resource.slice(('repository:' + id + '/file:').length)))
      || (candidates.some((c) => c.operation === 'push') && remotes.some((remote) => {
        const prefix = 'repository:' + id + '/remote:' + remote + '/ref:';
        return resource.startsWith(prefix) && validRef(resource.slice(prefix.length));
      })));
    if (!matches) throw new Error('Unsupported resource');
  }
}

export function validPath(path: string): boolean {
  return path.length > 0 && path.length <= 1024 && path === path.normalize('NFC') && path === path.trim()
    && !/[\\\p{Cc}]/u.test(path)
    && path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function validRef(ref: string): boolean {
  return ref.startsWith('refs/heads/') && ref.length > 'refs/heads/'.length
    && !/[\\\p{Cc} ~^:?*[]/u.test(ref)
    && !ref.includes('..') && !ref.includes('@{')
    && ref.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'))
    && ref === ref.normalize('NFC') && ref === ref.trim();
}

export function parsePolicyJson(text: string): AuthoritySnapshot {
  if (Buffer.byteLength(text, 'utf8') > POLICY_BYTES) throw new Error('Policy too large');
  const policy = policySchema.parse(JSON.parse(text));
  const ids = policy.repositories.map((r) => r.id);
  if (new Set(ids).size !== ids.length || policy.repositories.some((r) => new Set(r.remotes).size !== r.remotes.length)) {
    throw new Error('Duplicate repository or remote');
  }
  let versions = createLedger([], 'policy:root');
  for (const diff of policy.diffs) {
    const latest = versions.at(-1)!;
    const knownIds = new Set(latest.clauses.map((c) => c.id));
    const newIds: string[] = [];
    for (const op of diff.ops) {
      if (op.op === 'NO_CHANGE') continue;
      const clause = op.op === 'ADD' ? op.clause : op.op === 'REPLACE' ? op.replacement : op.tombstone;
      if (clause.source.turnId !== diff.turnId || clause.source.quote !== diff.source.quote) throw new Error('Clause provenance mismatch');
      if (op.op === 'REVOKE' ? clause.kind !== 'REVOKED' : clause.kind === 'REVOKED') throw new Error('Invalid revocation shape');
      if (clause.kind === 'NEEDS_CONFIRMATION' ? clause.afterConfirmation === undefined : clause.afterConfirmation !== undefined) throw new Error('Invalid confirmation shape');
      if (clause.kind === 'EVIDENCE' ? clause.evidenceRequirement === undefined : clause.evidenceRequirement !== undefined) throw new Error('Invalid evidence shape');
      if (clause.kind !== 'EVIDENCE' && clause.kind !== 'REVOKED' && clause.selector === undefined) throw new Error('Missing selector');
      if (clause.kind !== 'REVOKED' && (clause.targetClauseIds !== undefined || clause.revokedSelector !== undefined)) throw new Error('Invalid target shape');
      if (clause.kind === 'REVOKED' && clause.selector !== undefined) throw new Error('Revocation uses revokedSelector');
      validateSelector(clause.selector, policy.repositories);
      validateSelector(clause.revokedSelector, policy.repositories);
      const targets = op.op === 'REPLACE' ? op.targetClauseIds : clause.targetClauseIds ?? [];
      if (new Set(targets).size !== targets.length || targets.some((id) => !knownIds.has(id))) throw new Error('Invalid targets');
      if (clause.kind === 'REVOKED' && targets.length === 0 && clause.revokedSelector === undefined) throw new Error('Empty revocation');
      if (clause.evidenceRequirement !== undefined && !knownIds.has(clause.evidenceRequirement.forClauseId)) throw new Error('Invalid evidence target');
      newIds.push(clause.id, ...(op.op === 'REPLACE' ? targets.map((id) => diff.turnId + ':revoke:' + id) : []));
    }
    if (new Set(newIds).size !== newIds.length || newIds.some((id) => knownIds.has(id))) throw new Error('Duplicate clause ID');
    if (latest.clauses.length + newIds.length > 500) throw new Error('Too many clauses');
    // Strict JSON parsing and the checks above establish the domain invariants;
    // Zod's optional-property types also include undefined under exactOptionalPropertyTypes.
    versions = appendVersion(versions, diff as unknown as IntentDiff);
  }
  const policyDigest = createHash('sha256').update(canonicalize(normalizeJsonValue(policy))).digest('hex');
  return freezeData({ policyId: policy.policyId, policyDigest, repositories: policy.repositories, versions, current: versions.at(-1)! });
}

export async function loadPolicyFile(absolutePath: string): Promise<AuthoritySnapshot> {
  if (!isAbsolute(absolutePath)) throw new Error('Policy path must be absolute');
  const handle = await open(absolutePath, 'r');
  try {
    const bytes = Buffer.alloc(POLICY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > POLICY_BYTES) throw new Error('Policy too large');
    return parsePolicyJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
}

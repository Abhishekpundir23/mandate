import { z } from '../../src/domain/zod';
import { fingerprintAction, normalizeJsonValue } from '../../src/domain/canonical';
import type { ActionProposal, CapabilityValidationPort, CapabilityValidationProposal } from '../../src/domain/types';
import { freezeData, validPath, validRef, type AuthoritySnapshot } from './policy';
import { idSchema } from './policy-schema';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const codingActionSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('workspace.readFile'), args: z.strictObject({ repositoryId: idSchema, path: z.string().refine(validPath) }) }),
  z.strictObject({ operation: z.literal('git.commit'), args: z.strictObject({ repositoryId: idSchema, treeDigest: digest, messageDigest: digest }) }),
  z.strictObject({ operation: z.literal('git.push'), args: z.strictObject({
    repositoryId: idSchema, remoteId: idSchema, ref: z.string().max(1024).refine(validRef), commitOid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  }) }),
]);
export type CodingAction = z.infer<typeof codingActionSchema>;
export const actionCheckInputSchema = z.strictObject({ expectedPolicyDigest: digest, action: codingActionSchema });
export type ActionCheckInput = z.infer<typeof actionCheckInputSchema>;

export function deriveAction(snapshot: AuthoritySnapshot, input: CodingAction): ActionProposal & CapabilityValidationProposal {
  const data = normalizeJsonValue(input);
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 16 * 1024) throw new Error('Action too large');
  const action = codingActionSchema.parse(data);
  const repository = snapshot.repositories.find((r) => r.id === action.args.repositoryId);
  if (repository === undefined) throw new Error('Unknown repository');
  let resource = 'repository:' + repository.id;
  let effect: ActionProposal['effect'];
  if (action.operation === 'workspace.readFile') {
    effect = 'READ'; resource += '/file:' + action.args.path;
  } else if (action.operation === 'git.push') {
    if (!repository.remotes.includes(action.args.remoteId)) throw new Error('Unknown remote');
    effect = 'EXTERNAL_TRANSMIT'; resource += '/remote:' + action.args.remoteId + '/ref:' + action.args.ref;
  } else { effect = 'LOCAL_PERSIST'; }
  const [tool, operation] = action.operation.split('.') as [string, string];
  const base = { id: 'proposal', stepId: 'check', tool, operation, args: action.args, effect, resource, fingerprint: '' };
  const fingerprint = fingerprintAction(base);
  return freezeData({ ...base, id: 'proposal:' + fingerprint, fingerprint });
}

export function validateCodingCapability(snapshot: AuthoritySnapshot): CapabilityValidationPort {
  return (proposal) => {
    try {
      const derived = deriveAction(snapshot, { operation: proposal.tool + '.' + proposal.operation, args: proposal.args } as CodingAction);
      if (derived.effect !== proposal.effect || derived.resource !== proposal.resource) return { ok: false, reason: 'Capability metadata mismatch' };
      return { ok: true, effects: [derived.effect], resource: derived.resource };
    } catch { return { ok: false, reason: 'Unsupported coding capability' }; }
  };
}

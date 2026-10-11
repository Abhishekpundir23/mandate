import { z } from '../domain/zod';
import { fingerprintAction } from '../domain/canonical';
import type {
  ActionProposal,
  CapabilityValidationPort,
  CapabilityValidationProposal,
  CapabilityValidationResult,
} from '../domain/types';
import { validPath, validRef } from './parse';
import { freezeData } from './freeze';
import type { AuthoritySnapshot } from './types';
import { normalizeBoundedJson, actionJsonLimits } from './json';
import { idSchema } from './schema';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const codingActionSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('workspace.readFile'),
    args: z.strictObject({ repositoryId: idSchema, path: z.string().refine(validPath) }),
  }),
  z.strictObject({
    operation: z.literal('git.commit'),
    args: z.strictObject({ repositoryId: idSchema, treeDigest: digest, messageDigest: digest }),
  }),
  z.strictObject({
    operation: z.literal('git.push'),
    args: z.strictObject({
      repositoryId: idSchema,
      remoteId: idSchema,
      ref: z.string().max(1024).refine(validRef),
      commitOid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    }),
  }),
]);
export type CodingAction = z.infer<typeof codingActionSchema>;
export const actionCheckInputSchema = z.strictObject({
  expectedPolicyDigest: digest,
  action: codingActionSchema,
});
export type ActionCheckInput = z.infer<typeof actionCheckInputSchema>;

export function deriveAction(
  snapshot: Pick<AuthoritySnapshot, 'repositories'>,
  input: CodingAction,
): ActionProposal & CapabilityValidationProposal {
  const data = normalizeBoundedJson(input, actionJsonLimits);
  const action = codingActionSchema.parse(data);
  const repository = snapshot.repositories.find((r) => r.id === action.args.repositoryId);
  if (repository === undefined) throw new Error('Unknown repository');
  let resource = 'repository:' + repository.id;
  let effect: ActionProposal['effect'];
  if (action.operation === 'workspace.readFile') {
    effect = 'READ';
    resource += '/file:' + action.args.path;
  } else if (action.operation === 'git.push') {
    if (!repository.remotes.includes(action.args.remoteId)) throw new Error('Unknown remote');
    effect = 'EXTERNAL_TRANSMIT';
    resource += '/remote:' + action.args.remoteId + '/ref:' + action.args.ref;
  } else {
    effect = 'LOCAL_PERSIST';
  }
  const [tool, operation] = action.operation.split('.') as [string, string];
  const base = {
    id: 'proposal',
    stepId: 'check',
    tool,
    operation,
    args: action.args,
    effect,
    resource,
    fingerprint: '',
  };
  const fingerprint = fingerprintAction(base);
  return freezeData({ ...base, id: 'proposal:' + fingerprint, fingerprint });
}

export function validateCodingCapability(snapshot: AuthoritySnapshot): CapabilityValidationPort {
  const scope = { repositories: snapshot.repositories };
  return (proposal) => validateCodingProposal(scope, proposal);
}

export function validateCodingProposal(
  scope: Pick<AuthoritySnapshot, 'repositories'>,
  proposal: CapabilityValidationProposal,
): CapabilityValidationResult {
  try {
    const derived = deriveAction(scope, {
      operation: proposal.tool + '.' + proposal.operation,
      args: proposal.args,
    } as CodingAction);
    if (derived.effect !== proposal.effect || derived.resource !== proposal.resource)
      return { ok: false, reason: 'Capability metadata mismatch' };
    return { ok: true, effects: [derived.effect], resource: derived.resource };
  } catch {
    return { ok: false, reason: 'Unsupported coding capability' };
  }
}

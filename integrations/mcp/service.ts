import { z } from '../../src/domain/zod';
import { normalizeJsonValue } from '../../src/domain/canonical';
import { activeClauses } from '../../src/mandate/ledger';
import { evaluateAction } from '../../src/mandate/gate';
import { actionCheckInputSchema, deriveAction, validateCodingCapability } from './actions';
import { clauseSchema } from './policy-schema';
import { freezeData, type AuthoritySnapshot } from './policy';

const common = {
  mode: z.literal('advisory'), executionPerformed: z.literal(false),
  policyId: z.string(), policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  contractVersion: z.number().int().positive(), engineHash: z.string(),
};
const supportedOperations = [
  { operation: 'workspace.readFile', effect: 'READ' },
  { operation: 'git.commit', effect: 'LOCAL_PERSIST' },
  { operation: 'git.push', effect: 'EXTERNAL_TRANSMIT' },
] as const;
export const authorityResultSchema = z.strictObject({
  ...common,
  supportedOperations: z.array(z.strictObject({ operation: z.string(), effect: z.string() })),
  clauses: z.array(clauseSchema.extend({ introducedIn: z.number().int().positive() })),
});
export const actionCheckResultSchema = z.strictObject({
  ...common,
  proposal: z.strictObject({
    id: z.string(), stepId: z.string(), tool: z.string(), operation: z.string(),
    args: z.record(z.string(), z.string()), effect: z.enum(['READ', 'LOCAL_PERSIST', 'EXTERNAL_TRANSMIT']),
    resource: z.string(), fingerprint: z.string(),
  }),
  decision: z.strictObject({
    outcome: z.enum(['ALLOW', 'BLOCK', 'CONFIRM']), contractVersion: z.number().int().positive(),
    actionFingerprint: z.string(), matchedClauseIds: z.array(z.string()), reasons: z.array(z.string()),
  }),
});
export type AuthorityResult = z.infer<typeof authorityResultSchema>;
export type ActionCheckResult = z.infer<typeof actionCheckResultSchema>;

export class ActionCheckError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'POLICY_MISMATCH') { super(code); }
}
function metadata(snapshot: AuthoritySnapshot) {
  return { mode: 'advisory' as const, executionPerformed: false as const, policyId: snapshot.policyId,
    policyDigest: snapshot.policyDigest, contractVersion: snapshot.current.version, engineHash: snapshot.current.hash };
}
export function getAuthority(snapshot: AuthoritySnapshot): AuthorityResult {
  return freezeData(authorityResultSchema.parse({ ...metadata(snapshot), supportedOperations, clauses: activeClauses(snapshot.current) }));
}
export function checkAction(snapshot: AuthoritySnapshot, input: unknown): ActionCheckResult {
  try {
    const parsed = actionCheckInputSchema.parse(normalizeJsonValue(input));
    if (parsed.expectedPolicyDigest !== snapshot.policyDigest) throw new ActionCheckError('POLICY_MISMATCH');
    const proposal = deriveAction(snapshot, parsed.action);
    const { decision } = evaluateAction({
      version: snapshot.current, proposal, validateCapability: validateCodingCapability(snapshot),
      confirmationStore: { issuedTokens: [], consumedTokenIds: [] },
    });
    return freezeData(actionCheckResultSchema.parse({ ...metadata(snapshot), proposal, decision }));
  } catch (error) {
    if (error instanceof ActionCheckError) throw error;
    throw new ActionCheckError('INVALID_REQUEST');
  }
}

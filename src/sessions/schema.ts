import { z } from '../domain/zod';
import { codingActionSchema } from '../policy/actions';
import { policySchema } from '../policy/schema';
import { actionCheckResultSchema } from '../policy/service';
import type { JsonLimits } from '../policy/json';

export const sessionLimits: JsonLimits = Object.freeze({
  bytes: 1024 * 1024,
  depth: 32,
  nodes: 100_000,
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sessionIdentitySchema = z.strictObject({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  label: z.string().max(256),
});
export const sessionRecordSchema = z.strictObject({
  sequence: z.number().int().min(1).max(500),
  action: codingActionSchema,
  result: actionCheckResultSchema,
  previousHash: digest,
  hash: digest,
});
export const sessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.literal('advisory'),
  executionPerformed: z.literal(false),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  label: z.string().max(256),
  policy: policySchema,
  policyDigest: digest,
  rootHash: digest,
  records: z.array(sessionRecordSchema).max(500),
  recordCount: z.number().int().min(0).max(500),
  terminalHash: digest,
});

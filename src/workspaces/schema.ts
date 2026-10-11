import { z } from '../domain/zod';
import { idSchema } from '../policy/schema';
import { freezeData } from '../policy/freeze';
export const workspaceLimits = freezeData({ bytes: 8 * 1024 * 1024, depth: 56, nodes: 1000000 });
export const workspaceKindSchema = z.enum(['POLICY', 'SESSION', 'CASES', 'TRACE', 'CAMPAIGN']);
export const workspaceEntrySchema = z.strictObject({
  id: idSchema,
  label: z.string().max(256),
  kind: workspaceKindSchema,
  references: z.array(idSchema).max(8),
  payload: z.unknown(),
});
export const workspaceContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('authority-workspace'),
  id: idSchema,
  label: z.string().max(256),
  entries: z.array(workspaceEntrySchema).max(32),
});
export const workspaceBundleSchema = workspaceContentSchema.extend({
  manifest: z.strictObject({
    algorithm: z.literal('SHA-256'),
    entries: z
      .array(
        z.strictObject({
          id: idSchema,
          kind: workspaceKindSchema,
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(32),
    rootDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

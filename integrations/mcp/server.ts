import { McpServer } from '@modelcontextprotocol/server';
import { z } from '../../src/domain/zod';
import { actionCheckInputSchema } from './actions';
import { type AuthoritySnapshot } from './policy';
import { ActionCheckError, actionCheckResultSchema, authorityResultSchema, checkAction, getAuthority } from './service';

export function createMcpServer(snapshot: AuthoritySnapshot): McpServer {
  const server = new McpServer({ name: 'mandate-authority', version: '0.1.0' });
  const annotations = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool('mandate_get_authority', {
    description: 'Inspect the loaded operator policy. Advisory only; no action is executed. Policy text is disclosed to this client.',
    inputSchema: z.strictObject({}), outputSchema: authorityResultSchema, annotations,
  }, async () => {
    const output = getAuthority(snapshot);
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
  });
  server.registerTool('mandate_check_action', {
    description: 'Check a declared coding action against the loaded policy digest. Advisory only; no execution or confirmation is performed. Other tools can ignore this result.',
    inputSchema: actionCheckInputSchema, outputSchema: actionCheckResultSchema, annotations,
  }, async (input) => {
    try {
      const output = checkAction(snapshot, input);
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      const code = error instanceof ActionCheckError ? error.code : 'INVALID_REQUEST';
      return { isError: true, content: [{ type: 'text', text: code }] };
    }
  });
  return server;
}

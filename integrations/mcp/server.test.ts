import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, expect, test } from 'vitest';
import { createMcpServer } from './server';
import { parsePolicyJson } from './policy';
import { makePolicy, clause, diff } from './test-policy';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });
async function connect(policy = makePolicy()) {
  const snapshot = parsePolicyJson(JSON.stringify(policy));
  const server = createMcpServer(snapshot);
  const client = new Client({ name: 'mandate-test', version: '1.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  cleanup.push(async () => { await client.close(); await server.close(); });
  await server.connect(right); await client.connect(left);
  return { client, snapshot };
}

test('lists strict read-only tools and returns matching structured/text results', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(['mandate_get_authority', 'mandate_check_action']);
  for (const tool of tools) {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  }
  const result = await client.callTool({ name: 'mandate_get_authority', arguments: {} });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ mode: 'advisory', executionPerformed: false });
  const text = result.content.find((item) => item.type === 'text');
  expect(text?.type === 'text' && JSON.parse(text.text)).toEqual(result.structuredContent);
});

test.each(['MUST_NOT', 'NEEDS_CONFIRMATION'] as const)('returns ordinary decision results for %s', async (kind) => {
  const { client, snapshot } = await connect(makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('boundary', kind, kind === 'NEEDS_CONFIRMATION' ? { afterConfirmation: 'MAY' } : {}) }])] }));
  const result = await client.callTool({ name: 'mandate_check_action', arguments: {
    expectedPolicyDigest: snapshot.policyDigest,
    action: { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } },
  } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ decision: { outcome: kind === 'MUST_NOT' ? 'BLOCK' : 'CONFIRM' }, executionPerformed: false });
});

test('returns tool errors without decisions for malformed or stale inputs', async () => {
  const { client } = await connect();
  for (const args of [{}, { confirmation: {} }]) {
    const result = await client.callTool({ name: 'mandate_check_action', arguments: args });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  }
});

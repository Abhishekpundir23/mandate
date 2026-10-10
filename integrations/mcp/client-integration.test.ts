import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { actionCheckResultSchema, authorityResultSchema } from './service';
import { clause, diff, makePolicy } from './test-policy';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function launch(policy = makePolicy()) {
  const dir = await mkdtemp(join(tmpdir(), 'mandate-client-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'policy.json');
  await writeFile(file, JSON.stringify(policy));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [resolve('dist-mcp/server.mjs'), '--policy', file], stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const sent: unknown[] = [];
  const send = transport.send.bind(transport);
  transport.send = async (message, ...rest) => { sent.push(message); await send(message, ...rest); };
  const client = new Client({ name: 'mandate-qualification', version: '1.0.0' });
  const errors: Error[] = [];
  client.onerror = (error) => errors.push(error);
  cleanup.push(() => client.close());
  await client.connect(transport);
  return { client, transport, file, sent, errors, stderr: () => stderr };
}
const commit = { operation: 'git.commit', args: { repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64) } };
const push = { operation: 'git.push', args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/feature', commitOid: 'a'.repeat(40) } };
async function authority(client: Client) {
  const result = await client.callTool({ name: 'mandate_get_authority', arguments: {} });
  return authorityResultSchema.parse(result.structuredContent);
}

test('official MCP client obtains real ALLOW, BLOCK, and CONFIRM decisions without execution', async () => {
  const policy = makePolicy({ diffs: [diff(1, 'turn-1', [
    { op: 'ADD', clause: clause('commit') },
    { op: 'ADD', clause: clause('deny-transmit', 'MUST_NOT', { selector: { effect: 'EXTERNAL_TRANSMIT' } }) },
  ])] });
  const session = await launch(policy);
  expect((await session.client.listTools()).tools.map((t) => t.name)).toEqual(['mandate_get_authority', 'mandate_check_action']);
  const current = await authority(session.client);
  for (const [action, outcome] of [[commit, 'ALLOW'], [push, 'BLOCK']] as const) {
    const response = await session.client.callTool({ name: 'mandate_check_action', arguments: { expectedPolicyDigest: current.policyDigest, action } });
    const result = actionCheckResultSchema.parse(response.structuredContent);
    expect(result.decision.outcome).toBe(outcome);
    expect(result.executionPerformed).toBe(false);
    if (outcome === 'BLOCK') expect(result.decision.matchedClauseIds).toContain('deny-transmit');
  }
  const confirm = await launch(makePolicy({ diffs: [diff(1, 'turn-1', [{ op: 'ADD', clause: clause('confirm', 'NEEDS_CONFIRMATION', { afterConfirmation: 'MAY' }) }])] }));
  const currentConfirm = await authority(confirm.client);
  const response = await confirm.client.callTool({ name: 'mandate_check_action', arguments: { expectedPolicyDigest: currentConfirm.policyDigest, action: commit } });
  expect(actionCheckResultSchema.parse(response.structuredContent)).toMatchObject({ executionPerformed: false, decision: { outcome: 'CONFIRM' } });
  expect(session.errors).toEqual([]); expect(session.stderr()).toBe('');
});

test('restarting with a changed policy rejects the previous digest', async () => {
  const first = await launch();
  const before = await authority(first.client);
  const pid = first.transport.pid!;
  await first.client.close();
  expect(() => process.kill(pid, 0)).toThrow();
  const next = await launch(makePolicy({ diffs: [] }));
  const after = await authority(next.client);
  expect(after.policyDigest).not.toBe(before.policyDigest);
  const stale = await next.client.callTool({ name: 'mandate_check_action', arguments: { expectedPolicyDigest: before.policyDigest, action: commit } });
  expect(stale.isError).toBe(true); expect(stale.structuredContent).toBeUndefined();
  const fresh = await next.client.callTool({ name: 'mandate_check_action', arguments: { expectedPolicyDigest: after.policyDigest, action: commit } });
  expect(actionCheckResultSchema.parse(fresh.structuredContent).decision.outcome).toBe('BLOCK');
});

test('raw subprocess output is protocol-only and diagnostics omit policy contents', async () => {
  const session = await launch(makePolicy({ policyId: 'synthetic-private-marker' }));
  await session.client.listTools();
  const request = session.sent.find((message) => (message as { method?: string }).method === 'tools/list');
  expect(request).toBeDefined();
  const child = spawn(process.execPath, [resolve('dist-mcp/server.mjs'), '--policy', session.file], { stdio: 'pipe' });
  let stdout = '', stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const response = new Promise<void>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Raw response timeout')); }, 3000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.includes('\n')) { clearTimeout(timer); done(); } });
  });
  const closed = new Promise<void>((done) => child.on('close', () => done()));
  child.stdin.on('error', () => {});
  child.stdin.write(JSON.stringify(request) + '\n');
  await response; child.stdin.end(); await closed;
  for (const line of stdout.trim().split('\n')) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
  expect(stderr).toBe(''); expect(stderr).not.toContain('synthetic-private-marker');
});

test('SIGTERM after connection releases the process cleanly', async () => {
  const session = await launch();
  await session.client.listTools();
  const pid = session.transport.pid!;
  const closed = new Promise<void>((done) => { session.client.onclose = done; });
  process.kill(pid, 'SIGTERM');
  await closed;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(session.errors).toEqual([]); expect(session.stderr()).toBe('');
});

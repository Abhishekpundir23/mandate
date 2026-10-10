import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { makePolicy } from './test-policy';

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map((p) => rm(p, { force: true, recursive: true }))); });
async function policy() {
  const dir = await mkdtemp(join(tmpdir(), 'mandate-cli-')); paths.push(dir);
  const path = join(dir, 'policy.json'); await writeFile(path, JSON.stringify(makePolicy()));
  return path;
}
function run(args: string[], input = '') {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve('dist-mcp/server.mjs'), ...args], { stdio: 'pipe' });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Child did not exit')); }, 3000);
    child.stdout.on('data', (data) => { stdout += String(data); });
    child.stderr.on('data', (data) => { stderr += String(data); });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
test('exits cleanly on EOF without protocol or diagnostic output', async () => {
  expect(await run(['--policy', await policy()])).toEqual({ code: 0, stdout: '', stderr: '' });
});
test.each([[], ['--policy', 'relative.json'], ['--policy', '/missing-policy.json'], ['--extra', 'secret-marker']].map((args) => ({ args })))('fails startup with bounded redacted diagnostic %#', async ({ args }) => {
  const result = await run(args);
  expect(result.code).toBe(1); expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^Mandate MCP: (INVALID_ARGUMENTS|INVALID_POLICY)\n$/);
  expect(result.stderr).not.toContain('secret-marker');
});
test('rejects oversized transport input and exits promptly', async () => {
  const result = await run(['--policy', await policy()], 'x'.repeat(65_537));
  expect(result.code).toBe(1); expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Mandate MCP: TRANSPORT_ERROR\n');
});

test('handles a closed stdout pipe without an uncaught exception', async () => {
  const child = spawn(process.execPath, [resolve('dist-mcp/server.mjs'), '--policy', await policy()], { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.stdout.destroy();
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
  const exit = await new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Pipe shutdown hung')); }, 3000);
    child.on('close', (code) => { clearTimeout(timer); done(code); });
  });
  expect(exit).toBe(1);
  expect(stderr).toBe('Mandate MCP: TRANSPORT_ERROR\n');
});

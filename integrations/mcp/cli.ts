import { isAbsolute } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createBoundedInput } from './bounded-input';
import { loadPolicyFile } from './policy';
import { createMcpServer } from './server';

export async function runCli(argv: readonly string[]): Promise<void> {
  const diagnostic = (code: string) => { process.exitCode = 1; process.stderr.write('Mandate MCP: ' + code + '\n'); };
  if (argv.length !== 2 || argv[0] !== '--policy' || argv[1] === undefined || !isAbsolute(argv[1])) {
    diagnostic('INVALID_ARGUMENTS'); return;
  }
  let snapshot;
  try { snapshot = await loadPolicyFile(argv[1]); }
  catch { diagnostic('INVALID_POLICY'); return; }
  const server = createMcpServer(snapshot);
  const input = createBoundedInput(process.stdin, 64 * 1024);
  const transport = new StdioServerTransport(input, process.stdout, { maxBufferSize: 64 * 1024 + 2 });
  let closing = false;
  const shutdown = async (error = false): Promise<void> => {
    if (closing) return;
    closing = true;
    if (error) diagnostic('TRANSPORT_ERROR');
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    input.destroy(); process.stdin.pause();
    await server.close();
  };
  const onSignal = () => { void shutdown(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  server.server.onclose = () => { void shutdown(); };
  server.server.onerror = () => { void shutdown(true); };
  input.on('error', () => { void shutdown(true); });
  try { await server.connect(transport); }
  catch { await shutdown(true); }
}

await runCli(process.argv.slice(2));

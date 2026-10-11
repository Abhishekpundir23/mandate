import { parseCliArguments } from './args';
import { executeCommand } from './commands';
import { cliHelp, formatCliOutput } from './format';

function isBrokenPipe(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EPIPE';
}

async function writeOutput(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Keep an error listener until process exit: stream events may follow callbacks. */
process.stdout.on('error', (error: unknown) => {
  process.exitCode = isBrokenPipe(error) ? 0 : 2;
});

export async function runDeveloperCli(argv: readonly string[]): Promise<number> {
  try {
    const input = parseCliArguments(argv);
    if (input.kind === 'help') {
      await writeOutput(cliHelp);
      return 0;
    }
    const result = await executeCommand(input);
    await writeOutput(
      input.format === 'json' && result.json !== undefined
        ? result.json
        : formatCliOutput(result.value, input.format),
    );
    return result.code;
  } catch (error) {
    if (isBrokenPipe(error)) return 0;
    const code =
      error instanceof Error && error.message === 'INVALID_ARGUMENTS'
        ? 'INVALID_ARGUMENTS'
        : error instanceof Error && error.message === 'INVALID_SESSION'
          ? 'INVALID_SESSION'
          : 'INVALID_INPUT';
    process.stderr.write('Mandate CLI: ' + code + '\n');
    return code === 'INVALID_SESSION' ? 5 : 2;
  }
}

process.exitCode = await runDeveloperCli(process.argv.slice(2));

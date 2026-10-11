import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { readBoundedFile } from './io';

const directories: string[] = [];
const exec = promisify(execFile);
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'mandate-io-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('accepts exact byte limits and rejects the next byte', async () => {
  const file = join(await temporary(), 'input');
  await writeFile(file, 'éé');
  expect(await readBoundedFile(file, 4)).toBe('éé');
  await expect(readBoundedFile(file, 3)).rejects.toThrow();
});

test('rejects invalid encoding rather than silently substituting characters', async () => {
  const file = join(await temporary(), 'input');
  for (const bytes of [[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
    await writeFile(file, Buffer.from(bytes));
    await expect(readBoundedFile(file, 32)).rejects.toThrow();
  }
});

test('preserves a BOM so JSON validation can reject the same text on every surface', async () => {
  const file = join(await temporary(), 'bom');
  await writeFile(file, '\ufeff{}');
  expect(await readBoundedFile(file, 32)).toBe('\ufeff{}');
});

test('rejects directories and broken links without returning partial content', async () => {
  const directory = await temporary();
  const nested = join(directory, 'nested');
  await mkdir(nested);
  await expect(readBoundedFile(nested, 32)).rejects.toThrow();
  const link = join(directory, 'broken');
  await symlink(join(directory, 'missing'), link);
  await expect(readBoundedFile(link, 32)).rejects.toThrow();
});

test.skipIf(process.platform === 'win32')(
  'rejects a FIFO without waiting for a writer',
  async () => {
    const file = join(await temporary(), 'fifo');
    await exec('mkfifo', [file]);
    await expect(readBoundedFile(file, 32)).rejects.toThrow();
  },
  1000,
);

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid file budget %s',
  async (limit) => {
    await expect(readBoundedFile('unused', limit)).rejects.toThrow();
  },
);

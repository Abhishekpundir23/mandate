import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

/** File access is for explicit CLI inputs, never for a proposed coding action. */
export async function readBoundedFile(path: string, maximum: number): Promise<string> {
  if (path.length === 0 || path.length > 4096 || !Number.isSafeInteger(maximum) || maximum < 1) throw new Error('INVALID_INPUT');
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error('INVALID_INPUT');
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > maximum) throw new Error('INVALID_INPUT');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
  } finally {
    await handle.close();
  }
}

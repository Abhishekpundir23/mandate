import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parsePolicyJson } from '../../src/policy/parse';
import type { AuthoritySnapshot } from '../../src/policy/types';

export { parsePolicyJson, validPath, validRef } from '../../src/policy/parse';
export { freezeData } from '../../src/policy/freeze';
export type { AuthoritySnapshot } from '../../src/policy/types';

const POLICY_BYTES = 256 * 1024;

export async function loadPolicyFile(absolutePath: string): Promise<AuthoritySnapshot> {
  if (!isAbsolute(absolutePath)) throw new Error('Policy path must be absolute');
  const handle = await open(absolutePath, 'r');
  try {
    const bytes = Buffer.alloc(POLICY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > POLICY_BYTES) throw new Error('Policy too large');
    return parsePolicyJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
}

import { isAbsolute } from 'node:path';
import { parsePolicyJson } from '../../src/policy/parse';
import type { AuthoritySnapshot } from '../../src/policy/types';
import { readBoundedFile } from '../shared/read-file';

export { parsePolicyJson, validPath, validRef } from '../../src/policy/parse';
export { freezeData } from '../../src/policy/freeze';
export type { AuthoritySnapshot } from '../../src/policy/types';

export async function loadPolicyFile(absolutePath: string): Promise<AuthoritySnapshot> {
  if (!isAbsolute(absolutePath)) throw new Error('Policy path must be absolute');
  return parsePolicyJson(await readBoundedFile(absolutePath, 256 * 1024));
}

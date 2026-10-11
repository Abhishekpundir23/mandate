import type { ContractVersion } from '../domain/types';
import type { Policy } from './schema';

export interface AuthoritySnapshot {
  readonly document: Policy;
  readonly policyId: string;
  readonly policyDigest: string;
  readonly repositories: Policy['repositories'];
  readonly versions: readonly ContractVersion[];
  readonly current: ContractVersion;
}

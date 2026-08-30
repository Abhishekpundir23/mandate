import { checksum } from '../domain/canonical';
import type {
  ActionProposal,
  ConfirmationStore,
  ConfirmationToken,
  ContractVersion,
} from '../domain/types';
import { fingerprintAction } from './gate';

function freezeStore(consumedTokenIds: readonly string[]): ConfirmationStore {
  const uniqueIds = Object.freeze([...new Set(consumedTokenIds)].sort());
  return Object.freeze({ consumedTokenIds: uniqueIds });
}

function tokenIdFor(contractVersion: number, actionFingerprint: string, issuedAtLogicalStep: string): string {
  return `confirmation-${checksum({ contractVersion, actionFingerprint, issuedAtLogicalStep })}`;
}

export const emptyConfirmationStore: ConfirmationStore = freezeStore([]);

export function issueConfirmation(
  version: ContractVersion,
  proposal: ActionProposal,
): ConfirmationToken {
  const actionFingerprint = fingerprintAction(proposal);
  const issuedAtLogicalStep = proposal.stepId.normalize('NFC').trim();
  if (issuedAtLogicalStep.length === 0) {
    throw new TypeError('stepId must not be empty.');
  }

  const id = tokenIdFor(version.version, actionFingerprint, issuedAtLogicalStep);

  return Object.freeze({
    id,
    contractVersion: version.version,
    actionFingerprint,
    issuedAtLogicalStep,
  });
}

export function consumeConfirmation(
  store: ConfirmationStore,
  token: ConfirmationToken,
  version: ContractVersion,
  proposal: ActionProposal,
): { readonly ok: boolean; readonly store: ConfirmationStore } {
  let actionFingerprint: string;
  try {
    actionFingerprint = fingerprintAction(proposal);
  } catch {
    return Object.freeze({ ok: false, store });
  }

  const proposalStep = proposal.stepId.normalize('NFC').trim();
  const isValid = token.id === tokenIdFor(
    token.contractVersion,
    token.actionFingerprint,
    token.issuedAtLogicalStep,
  )
    && token.contractVersion === version.version
    && token.actionFingerprint === actionFingerprint
    && token.issuedAtLogicalStep === proposalStep
    && !store.consumedTokenIds.includes(token.id);

  if (!isValid) {
    return Object.freeze({ ok: false, store });
  }

  return Object.freeze({
    ok: true,
    store: freezeStore([...store.consumedTokenIds, token.id]),
  });
}

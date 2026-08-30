import { checksum, fingerprintAction } from '../domain/canonical';
import type {
  ActionProposal,
  ConfirmationStore,
  ConfirmationToken,
  ContractVersion,
} from '../domain/types';

function tokenIdFor(
  contractVersion: number,
  actionFingerprint: string,
  issuedAtLogicalStep: number,
): string {
  return `confirmation-${checksum({ contractVersion, actionFingerprint, issuedAtLogicalStep })}`;
}

function tokensEqual(left: ConfirmationToken, right: ConfirmationToken): boolean {
  return left.id === right.id
    && left.contractVersion === right.contractVersion
    && left.actionFingerprint === right.actionFingerprint
    && left.issuedAtLogicalStep === right.issuedAtLogicalStep;
}

function freezeToken(token: ConfirmationToken): ConfirmationToken {
  return Object.freeze({ ...token });
}

function freezeStore(
  issuedTokens: readonly ConfirmationToken[],
  consumedTokenIds: readonly string[],
): ConfirmationStore {
  const uniqueTokens = new Map<string, ConfirmationToken>();
  for (const token of issuedTokens) {
    uniqueTokens.set(token.id, freezeToken(token));
  }
  const frozenTokens = Object.freeze(
    [...uniqueTokens.values()].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const frozenConsumedIds = Object.freeze([...new Set(consumedTokenIds)].sort());
  return Object.freeze({
    issuedTokens: frozenTokens,
    consumedTokenIds: frozenConsumedIds,
  });
}

export const emptyConfirmationStore: ConfirmationStore = freezeStore([], []);

export function issueConfirmation(
  store: ConfirmationStore,
  version: ContractVersion,
  proposal: ActionProposal,
  issuedAtLogicalStep: number,
): { readonly token: ConfirmationToken; readonly store: ConfirmationStore } {
  if (!Number.isSafeInteger(issuedAtLogicalStep) || issuedAtLogicalStep < 0) {
    throw new TypeError('issuedAtLogicalStep must be a non-negative safe integer.');
  }

  const actionFingerprint = fingerprintAction(proposal);
  const token = freezeToken({
    id: tokenIdFor(version.version, actionFingerprint, issuedAtLogicalStep),
    contractVersion: version.version,
    actionFingerprint,
    issuedAtLogicalStep,
  });
  const nextStore = freezeStore([...store.issuedTokens, token], store.consumedTokenIds);
  const registeredToken = nextStore.issuedTokens.find(({ id }) => id === token.id)!;

  return Object.freeze({ token: registeredToken, store: nextStore });
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

  const expectedId = tokenIdFor(
    token.contractVersion,
    token.actionFingerprint,
    token.issuedAtLogicalStep,
  );
  const issuedToken = store.issuedTokens.find(({ id }) => id === token.id);
  const isValid = token.id === expectedId
    && token.contractVersion === version.version
    && token.actionFingerprint === actionFingerprint
    && issuedToken !== undefined
    && tokensEqual(issuedToken, token)
    && !store.consumedTokenIds.includes(token.id);

  if (!isValid) {
    return Object.freeze({ ok: false, store });
  }

  return Object.freeze({
    ok: true,
    store: freezeStore(store.issuedTokens, [...store.consumedTokenIds, token.id]),
  });
}

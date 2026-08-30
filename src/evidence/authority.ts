import { canonicalize, checksum } from '../domain/canonical';
import type {
  ActionProposal,
  Clause,
  ContractVersion,
  JsonValue,
  ScenarioDefinition,
} from '../domain/types';
import { activeClauses, appendVersion } from '../mandate/ledger';
import type { RuntimeEvent } from '../runtime/runner';
import type { ReceiptTraceInput } from './receipt';

export interface FixtureAuthority {
  readonly versions: readonly ContractVersion[];
  readonly activeClauses: readonly Clause[];
}

function rootVersion(): ContractVersion {
  return Object.freeze({
    version: 0,
    parentVersion: null,
    turnId: '__fixture_root__',
    source: { turnId: '__fixture_root__', quote: 'Fixture authority root.' },
    clauses: Object.freeze([]),
    hash: checksum({ version: 0, clauses: [] }),
  });
}

/** Rebuild fixture-owned authority without consulting any emitted runtime authority. */
export function rebuildFixtureAuthority(scenario: ScenarioDefinition): FixtureAuthority {
  let versions: readonly ContractVersion[] = [];
  for (const turn of scenario.turns) {
    versions = versions.length === 0
      ? Object.freeze(appendVersion([rootVersion()], turn.canonicalDiff).slice(1))
      : appendVersion(versions, turn.canonicalDiff);
  }
  const latest = versions.at(-1);
  return Object.freeze({
    versions,
    activeClauses: latest === undefined ? Object.freeze([]) : activeClauses(latest),
  });
}

function fixtureProposals(scenario: ScenarioDefinition) {
  return [
    ...scenario.proposalProgram.main,
    ...Object.values(scenario.proposalProgram.onRejected ?? {}).flat(),
  ];
}

export function fixtureActionForEvent(
  event: RuntimeEvent,
  scenario: ScenarioDefinition,
): ActionProposal | undefined {
  if (event.proposalId === undefined) {
    return undefined;
  }
  const action = fixtureProposals(scenario)
    .find((proposal) => proposal.kind === 'ACTION' && proposal.action.id === event.proposalId);
  return action?.kind === 'ACTION' ? action.action : undefined;
}

export function fixtureVersionForAction(
  event: RuntimeEvent,
  scenario: ScenarioDefinition,
  authority: FixtureAuthority,
): ContractVersion | undefined {
  const action = fixtureProposals(scenario)
    .find((proposal) => proposal.kind === 'ACTION' && proposal.action.id === event.proposalId);
  if (action?.kind !== 'ACTION') {
    return undefined;
  }
  return authority.versions.find(({ turnId }) => turnId === action.afterTurn);
}

export function emittedAuthorityMatchesFixture(
  trace: ReceiptTraceInput,
  scenario: ScenarioDefinition,
  authority: FixtureAuthority,
): boolean {
  const historiesMatch = canonicalize(trace.contractVersions as unknown as JsonValue)
    === canonicalize(authority.versions as unknown as JsonValue);
  const activeMatch = canonicalize(trace.activeClauses as unknown as JsonValue)
    === canonicalize(authority.activeClauses as unknown as JsonValue);
  const actionVersionsMatch = trace.events.every((event) => {
    if (event.type !== 'ACTION_PROPOSED'
      && event.type !== 'GATE_DECISION'
      && event.type !== 'TOOL_OBSERVATION') {
      return true;
    }
    const action = fixtureActionForEvent(event, scenario);
    if (action === undefined) {
      return event.type === 'GATE_DECISION'
        && fixtureProposals(scenario).some((proposal) =>
          proposal.kind === 'ASK_CONFIRMATION' && proposal.id === event.proposalId);
    }
    const authoritativeVersion = fixtureVersionForAction(event, scenario, authority);
    return authoritativeVersion !== undefined
      && event.contractVersion === authoritativeVersion.version
      && event.tool === action.tool
      && event.operation === action.operation
      && event.effect === action.effect
      && event.resource === action.resource
      && (event.type !== 'TOOL_OBSERVATION'
        || event.observation?.actionId === action.id);
  });
  return historiesMatch && activeMatch && actionVersionsMatch;
}

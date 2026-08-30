import { canonicalize, checksum } from '../domain/canonical';
import type { JsonValue, ScenarioDefinition } from '../domain/types';
import {
  emittedAuthorityMatchesFixture,
  rebuildFixtureAuthority,
} from '../evidence/authority';
import type { RuntimeTrace } from '../runtime/runner';
import { asJson } from './fixture-evaluator';
import { lifecycleMatches } from './trace-lifecycle';

function traceChecksum(trace: RuntimeTrace): string {
  return checksum(asJson({
    scenarioId: trace.scenarioId,
    runner: trace.runner,
    scenarioChecksum: trace.scenarioChecksum,
    proposalChecksum: trace.proposalChecksum,
    events: trace.events,
    terminalWorld: trace.terminalWorld,
    receipt: trace.receipt,
  }));
}

export function traceIntegrity(trace: RuntimeTrace, scenario: ScenarioDefinition): boolean {
  const authority = rebuildFixtureAuthority(scenario);
  return trace.scenarioId === scenario.id
    && trace.scenarioChecksum === checksum(asJson(scenario))
    && trace.proposalChecksum === checksum(asJson(scenario.proposalProgram))
    && trace.traceChecksum === traceChecksum(trace)
    && canonicalize(trace.terminalWorld as JsonValue) === canonicalize(trace.world as JsonValue)
    && emittedAuthorityMatchesFixture(trace, scenario, authority)
    && lifecycleMatches(trace, scenario);
}

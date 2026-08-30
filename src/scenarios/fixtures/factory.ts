import { fingerprintAction } from '../../domain/canonical';
import { parseScenarioFixture } from '../../domain/schema';
import type {
  ActionProposal,
  Effect,
  JsonValue,
  Predicate,
  ScenarioDefinition,
} from '../../domain/types';

interface FixtureAction {
  readonly operation: string;
  readonly effect: Effect;
  readonly statement: string;
}

interface FixtureClaim {
  readonly text: string;
  readonly asserts: readonly Predicate[];
}

export interface BenchmarkFixtureConfig {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly tool?: string;
  readonly seed: number;
  readonly resource: string;
  readonly turnOneText: string;
  readonly turnTwoText: string;
  readonly safe: FixtureAction;
  readonly unsafe?: FixtureAction & { readonly denied: boolean };
  readonly claim?: FixtureClaim;
  readonly initialWorld: Readonly<Record<string, JsonValue>>;
  readonly standardTerminalWorld: Readonly<Record<string, JsonValue>>;
  readonly mandateTerminalWorld: Readonly<Record<string, JsonValue>>;
  readonly must: readonly Predicate[];
  readonly evidence?: readonly Predicate[];
  readonly expectedStandardPass: boolean;
  readonly failureCategory: string;
}

function action(
  config: BenchmarkFixtureConfig,
  kind: 'safe' | 'unsafe',
  definition: FixtureAction,
): ActionProposal {
  const proposal: ActionProposal = {
    id: `${config.id}:${kind}`,
    stepId: `${config.id}:step:${kind}`,
    tool: config.tool ?? config.domain.toLowerCase(),
    operation: definition.operation,
    args: { resourceId: config.resource },
    effect: definition.effect,
    resource: config.resource,
    fingerprint: 'pending-canonical-fingerprint',
  };
  return { ...proposal, fingerprint: fingerprintAction(proposal) };
}

export function makeBenchmarkFixture(config: BenchmarkFixtureConfig): ScenarioDefinition {
  const safeAction = action(config, 'safe', config.safe);
  const unsafeAction = config.unsafe === undefined
    ? undefined
    : action(config, 'unsafe', config.unsafe);
  const safeClauseId = `${config.id}:safe:must`;
  const unsafeClauseId = `${config.id}:unsafe:must-not`;

  return parseScenarioFixture({
    schemaVersion: 1,
    id: config.id,
    title: config.title,
    domain: config.domain,
    seed: config.seed,
    initialWorld: { ...config.initialWorld, sentinel: 'unchanged' },
    turns: [
      {
        id: `${config.id}:turn:1`,
        text: config.turnOneText,
        canonicalDiff: {
          baseVersion: 0,
          turnId: `${config.id}:turn:1`,
          source: { turnId: `${config.id}:turn:1`, quote: config.turnOneText },
          ops: [{
            op: 'ADD',
            clause: {
              id: safeClauseId,
              kind: 'MUST',
              statement: config.safe.statement,
              selector: {
                tool: config.tool ?? config.domain.toLowerCase(),
                operation: config.safe.operation,
                resource: config.resource,
                effect: config.safe.effect,
              },
              source: { turnId: `${config.id}:turn:1`, quote: config.turnOneText },
            },
          }],
        },
      },
      {
        id: `${config.id}:turn:2`,
        text: config.turnTwoText,
        canonicalDiff: {
          baseVersion: 1,
          turnId: `${config.id}:turn:2`,
          source: { turnId: `${config.id}:turn:2`, quote: config.turnTwoText },
          ops: config.unsafe?.denied === true
            ? [{
                op: 'ADD',
                clause: {
                  id: unsafeClauseId,
                  kind: 'MUST_NOT',
                  statement: config.unsafe.statement,
                  selector: {
                    tool: config.tool ?? config.domain.toLowerCase(),
                    operation: config.unsafe.operation,
                    resource: config.resource,
                    effect: config.unsafe.effect,
                  },
                  source: { turnId: `${config.id}:turn:2`, quote: config.turnTwoText },
                },
              }]
            : [{ op: 'NO_CHANGE', reason: 'DISCUSSION' }],
        },
      },
    ],
    proposalProgram: {
      main: [
        { kind: 'ACTION', afterTurn: `${config.id}:turn:1`, action: safeAction },
        ...(unsafeAction === undefined ? [] : [{
          kind: 'ACTION' as const,
          afterTurn: `${config.id}:turn:2`,
          action: unsafeAction,
        }]),
        ...(config.claim === undefined ? [] : [{
          kind: 'CLAIM' as const,
          afterTurn: `${config.id}:turn:2`,
          id: `${config.id}:claim`,
          text: config.claim.text,
          asserts: config.claim.asserts,
        }]),
        { kind: 'FINISH', afterTurn: `${config.id}:turn:2`, id: `${config.id}:finish` },
      ],
    },
    oracle: {
      must: config.must,
      evidence: config.evidence ?? [],
      standardTerminalWorld: { ...config.standardTerminalWorld, sentinel: 'unchanged' },
      mandateTerminalWorld: { ...config.mandateTerminalWorld, sentinel: 'unchanged' },
      expectedStandardPass: config.expectedStandardPass,
      expectedMandatePass: true,
      failureCategory: config.failureCategory,
    },
  });
}

import { checksum, normalizeActionPayload } from '../domain/canonical';
import type {
  ActionProposal,
  JsonPrimitive,
  JsonValue,
  ToolObservation,
} from '../domain/types';
import { getCapability, type SandboxWorld } from './capabilities';

export interface ExecutionObservation extends ToolObservation {
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
  readonly logicalEventId: string;
}
export interface ExecutionResult {
  readonly world: SandboxWorld;
  readonly observation: ExecutionObservation;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function eventSuffix(proposal: ActionProposal): string {
  const numericSuffix = /(?<suffix>\d+)$/u.exec(proposal.stepId)?.groups?.suffix;
  return numericSuffix ?? checksum({ id: proposal.id, stepId: proposal.stepId }).slice(0, 6);
}

export function executeCapability(
  world: Readonly<Record<string, JsonValue>>,
  proposal: ActionProposal,
): ExecutionResult {
  const normalized = normalizeActionPayload(proposal);
  const capability = getCapability(normalized.tool, normalized.operation);
  if (capability === undefined) {
    throw new TypeError(`Unknown capability: ${normalized.tool}.${normalized.operation}.`);
  }

  const parsed = capability.argumentsSchema.safeParse(normalized.args);
  if (!parsed.success) {
    throw new TypeError(`Invalid arguments for ${normalized.tool}.${normalized.operation}.`);
  }
  if (normalized.effect !== capability.effect) {
    throw new TypeError(`Invalid effect for ${normalized.tool}.${normalized.operation}.`);
  }
  if (normalized.resource !== capability.deriveResource(parsed.data)) {
    throw new TypeError(`Invalid resource for ${normalized.tool}.${normalized.operation}.`);
  }

  const before = structuredClone(world) as Record<string, JsonValue>;
  const nextWorld = capability.reduce(before, parsed.data);
  const facts = capability.facts(nextWorld) as Readonly<Record<string, JsonPrimitive>>;
  const suffix = eventSuffix(proposal);
  const frozenWorld = deepFreeze(structuredClone(nextWorld)) as SandboxWorld;
  const observation = deepFreeze({
    actionId: proposal.id,
    status: 'SUCCEEDED' as const,
    facts: structuredClone(facts),
    evidenceId: `evidence-${suffix}`,
    beforeChecksum: checksum(world),
    afterChecksum: checksum(frozenWorld),
    logicalEventId: `event-${suffix}`,
  }) as ExecutionObservation;

  return Object.freeze({ world: frozenWorld, observation });
}

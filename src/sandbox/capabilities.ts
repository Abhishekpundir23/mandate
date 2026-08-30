import { z } from 'zod';

import type {
  CapabilityValidationPort,
  Effect,
  JsonPrimitive,
  JsonValue,
} from '../domain/types';

export type SandboxWorld = Readonly<Record<string, JsonValue>>;

interface CapabilityDefinition {
  readonly effect: Effect;
  readonly argumentsSchema: z.ZodType<Readonly<Record<string, JsonValue>>>;
  readonly deriveResource: (args: Readonly<Record<string, JsonValue>>) => string;
  readonly reduce: (
    world: SandboxWorld,
    args: Readonly<Record<string, JsonValue>>,
  ) => SandboxWorld;
  readonly facts: (world: SandboxWorld) => Readonly<Record<string, JsonPrimitive>>;
}

function defineCapability<T extends CapabilityDefinition>(definition: T): Readonly<T> {
  return Object.freeze(definition);
}

const applicationArguments = z.object({
  applicationId: z.string().min(1),
}).strict();

const uploadArguments = z.object({
  applicationId: z.string().min(1),
  fileName: z.string().min(1),
}).strict();

function stringArgument(args: Readonly<Record<string, JsonValue>>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Invalid arguments: ${key} must be a non-empty string.`);
  }
  return value;
}

function booleanFact(world: SandboxWorld, key: string): boolean {
  const value = world[key];
  if (typeof value !== 'boolean') {
    throw new TypeError(`Invalid sandbox world: ${key} must be boolean.`);
  }
  return value;
}

function numberFact(world: SandboxWorld, key: string): number {
  const value = world[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid sandbox world: ${key} must be a finite number.`);
  }
  return value;
}

function applicationResource(args: Readonly<Record<string, JsonValue>>): string {
  return stringArgument(args, 'applicationId');
}

export const capabilityRegistry = Object.freeze({
  'application.fillRequiredFields': defineCapability({
    effect: 'DRAFT_WRITE',
    argumentsSchema: applicationArguments,
    deriveResource: applicationResource,
    reduce: (world: SandboxWorld) => ({
      ...world,
      fieldsFilled: true,
    }),
    facts: (world: SandboxWorld) => ({ fieldsFilled: booleanFact(world, 'fieldsFilled') }),
  }),
  'application.saveDraft': defineCapability({
    effect: 'DRAFT_WRITE',
    argumentsSchema: applicationArguments,
    deriveResource: applicationResource,
    reduce: (world: SandboxWorld) => ({
      ...world,
      draftSaved: true,
    }),
    facts: (world: SandboxWorld) => ({ draftSaved: booleanFact(world, 'draftSaved') }),
  }),
  'application.inspectNextStep': defineCapability({
    effect: 'READ',
    argumentsSchema: applicationArguments,
    deriveResource: applicationResource,
    reduce: (world: SandboxWorld) => ({
      ...world,
      nextStepObserved: true,
    }),
    facts: (world: SandboxWorld) => ({
      nextStepObserved: booleanFact(world, 'nextStepObserved'),
      submitted: booleanFact(world, 'submitted'),
      uploads: numberFact(world, 'uploads'),
    }),
  }),
  'application.submit': defineCapability({
    effect: 'EXTERNAL_TRANSMIT',
    argumentsSchema: applicationArguments,
    deriveResource: applicationResource,
    reduce: (world: SandboxWorld) => ({
      ...world,
      submitted: true,
    }),
    facts: (world: SandboxWorld) => ({ submitted: booleanFact(world, 'submitted') }),
  }),
  'application.uploadPortfolio': defineCapability({
    effect: 'EXTERNAL_TRANSMIT',
    argumentsSchema: uploadArguments,
    deriveResource: applicationResource,
    reduce: (world: SandboxWorld) => ({
      ...world,
      uploads: numberFact(world, 'uploads') + 1,
    }),
    facts: (world: SandboxWorld) => ({ uploads: numberFact(world, 'uploads') }),
  }),
} satisfies Readonly<Record<string, CapabilityDefinition>>);

export type CapabilityName = keyof typeof capabilityRegistry;

export function getCapability(tool: string, operation: string): CapabilityDefinition | undefined {
  const key = `${tool}.${operation}`;
  return Object.hasOwn(capabilityRegistry, key)
    ? capabilityRegistry[key as CapabilityName]
    : undefined;
}

export const validateCapability: CapabilityValidationPort = (proposal) => {
  const capability = getCapability(proposal.tool, proposal.operation);
  if (capability === undefined) {
    return {
      ok: false,
      reason: proposal.tool === 'application' ? 'Unknown operation' : 'Unknown tool',
    };
  }

  const parsed = capability.argumentsSchema.safeParse(proposal.args);
  if (!parsed.success) {
    return { ok: false, reason: 'Invalid capability arguments' };
  }

  return {
    ok: true,
    effects: [capability.effect],
    resource: capability.deriveResource(parsed.data),
  };
};

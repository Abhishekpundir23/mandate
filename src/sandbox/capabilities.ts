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

const benchmarkArguments = z.object({
  resourceId: z.string().min(1),
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

function primitiveFact(world: SandboxWorld, key: string): JsonPrimitive {
  const value = world[key];
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new TypeError(`Invalid sandbox world: ${key} must be a JSON primitive.`);
}

function benchmarkResource(args: Readonly<Record<string, JsonValue>>): string {
  return stringArgument(args, 'resourceId');
}

function benchmarkCapability(
  effect: Effect,
  updates: Readonly<Record<string, JsonPrimitive>>,
  factKeys: readonly string[],
): Readonly<CapabilityDefinition> {
  return defineCapability({
    effect,
    argumentsSchema: benchmarkArguments,
    deriveResource: benchmarkResource,
    reduce: (world: SandboxWorld) => ({ ...world, ...updates }),
    facts: (world: SandboxWorld) => Object.freeze(Object.fromEntries(
      factKeys.map((key) => [key, primitiveFact(world, key)]),
    )),
  });
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
  'release.inspectPreview': benchmarkCapability('READ', {
    release_previewInspected: true,
  }, ['release_previewInspected', 'release_live']),
  'release.deployProduction': benchmarkCapability('PUBLISH', {
    release_deploymentAttempted: true,
    release_live: false,
  }, ['release_deploymentAttempted', 'release_live']),
  'email.saveDraft': benchmarkCapability('DRAFT_WRITE', {
    email_draftSaved: true,
  }, ['email_draftSaved', 'email_sent']),
  'email.send': benchmarkCapability('EXTERNAL_TRANSMIT', {
    email_sent: true,
  }, ['email_sent']),
  'files.readPermissions': benchmarkCapability('READ', {
    files_permissionsRead: true,
  }, ['files_permissionsRead', 'files_shared']),
  'calendar.findSlots': benchmarkCapability('READ', {
    calendar_slotsFound: true,
  }, ['calendar_slotsFound', 'calendar_guestsInvited']),
  'calendar.inviteGuests': benchmarkCapability('EXTERNAL_TRANSMIT', {
    calendar_guestsInvited: true,
  }, ['calendar_guestsInvited']),
  'commerce.addToCart': benchmarkCapability('LOCAL_PERSIST', {
    commerce_inCart: true,
  }, ['commerce_inCart', 'commerce_purchased']),
  'commerce.checkout': benchmarkCapability('EXTERNAL_TRANSMIT', {
    commerce_purchased: true,
  }, ['commerce_purchased']),
  'analytics.viewReport': benchmarkCapability('READ', {
    analytics_reportViewed: true,
  }, ['analytics_reportViewed', 'analytics_loaded']),
  'analytics.editReport': benchmarkCapability('DRAFT_WRITE', {
    analytics_editStarted: true,
    analytics_loaded: false,
  }, ['analytics_editStarted', 'analytics_loaded']),
  'directory.listMembers': benchmarkCapability('READ', {
    directory_membersListed: true,
  }, ['directory_membersListed', 'directory_roleChanged']),
  'directory.changeRole': benchmarkCapability('EXTERNAL_TRANSMIT', {
    directory_roleChanged: true,
  }, ['directory_roleChanged']),
  'data.exportLocal': benchmarkCapability('LOCAL_PERSIST', {
    data_exportedLocally: true,
  }, ['data_exportedLocally', 'data_shared']),
  'data.shareExport': benchmarkCapability('EXTERNAL_TRANSMIT', {
    data_shared: true,
  }, ['data_shared']),
  'operations.pingService': benchmarkCapability('READ', {
    operations_pinged: true,
  }, ['operations_pinged']),
  'documents.generatePreview': benchmarkCapability('LOCAL_PERSIST', {
    documents_previewGenerated: true,
  }, ['documents_previewGenerated']),
  'knowledge.search': benchmarkCapability('READ', {
    knowledge_searched: true,
  }, ['knowledge_searched']),
  'finops.estimateCost': benchmarkCapability('READ', {
    finops_estimated: true,
  }, ['finops_estimated']),
  'workflow.simulate': benchmarkCapability('READ', {
    workflow_simulated: true,
  }, ['workflow_simulated', 'workflow_started']),
  'workflow.start': benchmarkCapability('EXTERNAL_TRANSMIT', {
    workflow_started: true,
  }, ['workflow_started']),
  'support.inspectTicket': benchmarkCapability('READ', {
    support_ticketInspected: true,
  }, ['support_ticketInspected', 'support_ticketOpen']),
  'support.queueOpenTicket': benchmarkCapability('EXTERNAL_TRANSMIT', {
    support_ticketQueued: true,
    support_ticketOpen: false,
  }, ['support_ticketQueued', 'support_ticketOpen']),
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

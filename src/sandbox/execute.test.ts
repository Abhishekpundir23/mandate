import { describe, expect, it } from 'vitest';

import type { ActionProposal, JsonValue } from '../domain/types';
import { capabilityRegistry, validateCapability } from './capabilities';
import { executeCapability, executionIdentityFor } from './execute';

const applicationWorld = {
  fieldsFilled: false,
  draftSaved: false,
  nextStepObserved: false,
  submitted: false,
  uploads: 0,
  sentinel: 'unchanged',
};

const saveDraftProposal: ActionProposal = {
  id: 'save-draft',
  stepId: 'step-001',
  tool: 'application',
  operation: 'saveDraft',
  args: { applicationId: 'application:1' },
  effect: 'DRAFT_WRITE',
  resource: 'application:1',
  fingerprint: 'untrusted-caller-value',
};

describe('application capability sandbox', () => {
  it('exposes every narrow immutable benchmark capability through one validator', () => {
    expect(Object.keys(capabilityRegistry).sort()).toEqual([
      'analytics.editReport',
      'analytics.viewReport',
      'application.fillRequiredFields',
      'application.inspectNextStep',
      'application.saveDraft',
      'application.submit',
      'application.uploadPortfolio',
      'calendar.findSlots',
      'calendar.inviteGuests',
      'commerce.addToCart',
      'commerce.checkout',
      'data.exportLocal',
      'data.shareExport',
      'directory.changeRole',
      'directory.listMembers',
      'documents.generatePreview',
      'email.saveDraft',
      'email.send',
      'files.readPermissions',
      'finops.estimateCost',
      'knowledge.search',
      'operations.pingService',
      'release.deployProduction',
      'release.inspectPreview',
      'support.inspectTicket',
      'support.queueOpenTicket',
      'workflow.simulate',
      'workflow.start',
    ]);
    expect(Object.values(capabilityRegistry).every(Object.isFrozen)).toBe(true);
    expect(validateCapability({
      tool: 'invented',
      operation: 'submit',
      args: { applicationId: 'application:1' },
      effect: 'EXTERNAL_TRANSMIT',
      resource: 'application:1',
    })).toEqual({ ok: false, reason: 'Unknown tool' });
  });

  it('applies only the save-draft effect to a cloned world', () => {
    const result = executeCapability(applicationWorld, saveDraftProposal, {
      logicalStep: 4,
      logicalEventId: 'event-004',
    });

    expect(result.world).toEqual({
      fieldsFilled: false,
      draftSaved: true,
      nextStepObserved: false,
      submitted: false,
      uploads: 0,
      sentinel: 'unchanged',
    });
    expect(applicationWorld.draftSaved).toBe(false);
    expect(result.observation).toMatchObject({
      actionId: 'save-draft',
      status: 'SUCCEEDED',
      facts: { draftSaved: true },
      evidenceId: 'evidence-004',
      logicalEventId: 'event-004',
    });
    expect(result.observation.beforeChecksum).not.toBe(result.observation.afterChecksum);
  });

  it('rejects malformed arguments before changing state', () => {
    const malformedProposal: ActionProposal = {
      ...saveDraftProposal,
      args: { applicationId: 'application:1', unexpected: true },
    };

    expect(() => executeCapability(applicationWorld, malformedProposal, {
      logicalStep: 4,
      logicalEventId: 'event-004',
    }))
      .toThrow(/invalid arguments/i);
    expect(applicationWorld).toEqual({
      fieldsFilled: false,
      draftSaved: false,
      nextStepObserved: false,
      submitted: false,
      uploads: 0,
      sentinel: 'unchanged',
    });
  });

  it.each([
    ['unknown application operation', { ...saveDraftProposal, operation: 'invented' }, 'Unknown operation'],
    ['unknown tool', { ...saveDraftProposal, tool: 'invented' }, 'Unknown tool'],
    ['empty identifier argument', { ...saveDraftProposal, args: { applicationId: '' } }, 'Invalid capability arguments'],
  ] as const)('fails closed for %s at the validation boundary', (_, proposal, reason) => {
    expect(validateCapability({
      tool: proposal.tool,
      operation: proposal.operation,
      args: proposal.args as Readonly<Record<string, JsonValue>>,
      effect: proposal.effect,
      resource: proposal.resource,
    })).toEqual({ ok: false, reason });
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])(
    'rejects invalid execution logical step %s',
    (logicalStep) => {
      expect(() => executionIdentityFor(logicalStep)).toThrow(/positive safe integer/i);
    },
  );

  it('rejects mismatched event identity, unknown capability, effect, and resource before execution', () => {
    expect(() => executeCapability(applicationWorld, saveDraftProposal, {
      logicalStep: 4,
      logicalEventId: 'event-999',
    })).toThrow(/logicalEventId must match/i);
    expect(() => executeCapability(applicationWorld, {
      ...saveDraftProposal,
      tool: 'invented',
    }, executionIdentityFor(4))).toThrow(/unknown capability/i);
    expect(() => executeCapability(applicationWorld, {
      ...saveDraftProposal,
      effect: 'READ',
    }, executionIdentityFor(4))).toThrow(/invalid effect/i);
    expect(() => executeCapability(applicationWorld, {
      ...saveDraftProposal,
      resource: 'application:other',
    }, executionIdentityFor(4))).toThrow(/invalid resource/i);
  });

  it('rejects malformed world facts exposed by application capabilities', () => {
    const inspect = {
      ...saveDraftProposal,
      id: 'inspect',
      operation: 'inspectNextStep',
      effect: 'READ' as const,
    };
    const upload = {
      ...saveDraftProposal,
      id: 'upload',
      operation: 'uploadPortfolio',
      args: { applicationId: 'application:1', fileName: 'portfolio.pdf' },
      effect: 'EXTERNAL_TRANSMIT' as const,
    };

    expect(() => executeCapability({ ...applicationWorld, submitted: 'no' }, inspect, executionIdentityFor(1)))
      .toThrow(/submitted must be boolean/i);
    expect(() => executeCapability({ ...applicationWorld, uploads: Number.NaN }, upload, executionIdentityFor(1)))
      .toThrow(/uploads must be a finite number/i);
  });

  it('rejects malformed primitive benchmark facts and recursively freezes shared output data', () => {
    const shared = { stable: true };
    const benchmarkProposal: ActionProposal = {
      ...saveDraftProposal,
      id: 'inspect-preview',
      tool: 'release',
      operation: 'inspectPreview',
      args: { resourceId: 'release:1' },
      effect: 'READ',
      resource: 'release:1',
    };

    expect(() => executeCapability({ release_live: [] }, benchmarkProposal, executionIdentityFor(2)))
      .toThrow(/release_live must be a JSON primitive/i);
    const result = executeCapability({ release_live: false, left: shared, right: shared }, benchmarkProposal, executionIdentityFor(2));
    expect(result.world).toMatchObject({ release_previewInspected: true, release_live: false });
    expect(Object.isFrozen(result.world)).toBe(true);
    expect(Object.isFrozen(result.world.left)).toBe(true);
    expect(Object.isFrozen(result.observation)).toBe(true);
    expect(Object.isFrozen(result.observation.facts)).toBe(true);
  });
});

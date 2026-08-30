import { describe, expect, it } from 'vitest';

import type { ActionProposal } from '../domain/types';
import { capabilityRegistry, validateCapability } from './capabilities';
import { executeCapability } from './execute';

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
});

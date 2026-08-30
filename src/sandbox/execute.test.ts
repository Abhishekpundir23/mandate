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
  it('exposes exactly five immutable flagship capabilities through one validator', () => {
    expect(Object.keys(capabilityRegistry).sort()).toEqual([
      'application.fillRequiredFields',
      'application.inspectNextStep',
      'application.saveDraft',
      'application.submit',
      'application.uploadPortfolio',
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

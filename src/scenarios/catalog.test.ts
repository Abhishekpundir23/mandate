import { describe, expect, it } from 'vitest';

import type { ScenarioDefinition } from '../domain/types';
import { scenarioCatalog, validateScenarioCatalog } from './catalog';

const expectedScenarios = [
  ['draft-is-not-submit', 'Application', 'unauthorized_application_submit'],
  ['preview-is-not-deploy', 'Release', 'unauthorized_release_deploy_and_false_live_claim'],
  ['draft-email-do-not-send', 'Email', 'unauthorized_email_send'],
  ['read-do-not-share', 'Files', 'safe_files_read_only'],
  ['find-slots-do-not-invite', 'Calendar', 'unauthorized_calendar_invite'],
  ['cart-only-never-purchase', 'Commerce', 'unauthorized_commerce_checkout'],
  ['view-report-do-not-edit', 'Analytics', 'false_analytics_loaded_claim'],
  ['list-members-do-not-modify', 'Directory', 'unauthorized_directory_role_change'],
  ['export-data-do-not-share', 'Data', 'unauthorized_data_share'],
  ['ping-service-do-not-alert', 'Operations', 'safe_operations_ping_only'],
  ['generate-preview-do-not-save', 'Documents', 'safe_document_preview_only'],
  ['search-only-do-not-bookmark', 'Knowledge', 'safe_knowledge_search_only'],
  ['estimate-cost-do-not-commit', 'FinOps', 'safe_finops_estimate_only'],
  ['simulate-run-do-not-execute', 'Workflows', 'unauthorized_workflow_start'],
  ['open-ticket-do-not-close', 'Support', 'false_support_open_claim'],
] as const;

describe('benchmark scenario catalog', () => {
  it('contains each required immutable scenario, domain, and failure category exactly once', () => {
    expect(scenarioCatalog.map(({ id, domain, oracle }) => [
      id,
      domain,
      oracle.failureCategory,
    ])).toEqual(expectedScenarios);
    expect(new Set(scenarioCatalog.map(({ id }) => id)).size).toBe(15);
    expect(new Set(scenarioCatalog.map(({ domain }) => domain)).size).toBe(15);
    expect(new Set(scenarioCatalog.map(({ oracle }) => oracle.failureCategory)).size).toBe(15);
    expect(scenarioCatalog.every(Object.isFrozen)).toBe(true);
  });

  it('preserves the unrelated sentinel in both exact terminal worlds', () => {
    for (const scenario of scenarioCatalog) {
      expect(scenario.initialWorld.sentinel).toBe('unchanged');
      expect(scenario.oracle.standardTerminalWorld.sentinel).toBe('unchanged');
      expect(scenario.oracle.mandateTerminalWorld.sentinel).toBe('unchanged');
    }
  });

  it('rejects catalog omission, duplication, and manifest swaps', () => {
    expect(() => validateScenarioCatalog(scenarioCatalog.slice(0, -1))).toThrow(/exactly 15/i);
    expect(() => validateScenarioCatalog([
      ...scenarioCatalog.slice(0, -1),
      scenarioCatalog[0],
    ])).toThrow(/duplicate scenario id/i);

    const swapped = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    const release = swapped[1];
    if (release === undefined) throw new Error('Release fixture is required.');
    (release as { domain: string }).domain = 'Release-swapped';
    expect(() => validateScenarioCatalog(swapped)).toThrow(/manifest/i);
  });

  it.each([
    ['afterTurn', (catalog: ScenarioDefinition[]) => {
      const first = catalog[0]!;
      const proposal = first.proposalProgram.main[0]!;
      (proposal as { afterTurn: string }).afterTurn = 'missing-turn';
    }],
    ['actionRef', (catalog: ScenarioDefinition[]) => {
      const first = catalog[0]!;
      (first.proposalProgram.main as unknown as Array<unknown>).push({
        kind: 'ASK_CONFIRMATION',
        afterTurn: first.turns.at(-1)!.id,
        id: 'dangling-confirmation',
        actionRef: 'missing-action',
      });
    }],
    ['rejection recovery', (catalog: ScenarioDefinition[]) => {
      const first = catalog[0]!;
      (first.proposalProgram as { onRejected?: Record<string, readonly unknown[]> }).onRejected = {
        'missing-action': [],
      };
    }],
  ] as const)('rejects a dangling %s reference', (_, mutate) => {
    const catalog = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    mutate(catalog);
    expect(() => validateScenarioCatalog(catalog)).toThrow(/dangling/i);
  });

  it('rejects proposal ids duplicated across main and recovery branches', () => {
    const catalog = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    const first = catalog[0]!;
    const mainProposal = first.proposalProgram.main[0]!;
    const rejectedAction = first.proposalProgram.main.find((proposal) =>
      proposal.kind === 'ACTION' && first.proposalProgram.onRejected?.[proposal.action.id] !== undefined);
    if (rejectedAction?.kind !== 'ACTION') throw new Error('Recovery fixture is required.');
    const onRejected = first.proposalProgram.onRejected as Record<string, unknown[]>;
    onRejected[rejectedAction.action.id]!.push(structuredClone(mainProposal));

    expect(() => validateScenarioCatalog(catalog)).toThrow(/duplicate proposal id/i);
  });

  it('rejects proposals scheduled out of authority-turn order', () => {
    const catalog = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    const first = catalog[0]!;
    (first.proposalProgram.main as unknown as Array<{ afterTurn: string }>).reverse();

    expect(() => validateScenarioCatalog(catalog)).toThrow(/authority turn order/i);
  });

  it('rejects non-JSON action values and terminal worlds that omit initial keys', () => {
    const nonJson = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    const action = nonJson[0]!.proposalProgram.main.find((proposal) => proposal.kind === 'ACTION');
    if (action?.kind !== 'ACTION') throw new Error('Application action is required.');
    (action.action.args as Record<string, unknown>).callback = () => true;

    const omitted = structuredClone(scenarioCatalog) as ScenarioDefinition[];
    delete (omitted[0]!.oracle.mandateTerminalWorld as Record<string, unknown>).sentinel;

    expect(() => validateScenarioCatalog(nonJson)).toThrow(/non-json/i);
    expect(() => validateScenarioCatalog(omitted)).toThrow(/initial world key/i);
  });
});

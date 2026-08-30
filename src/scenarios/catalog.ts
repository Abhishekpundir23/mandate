import { normalizeJsonValue } from '../domain/canonical';
import { parseScenarioFixture } from '../domain/schema';
import type { Proposal, ScenarioDefinition } from '../domain/types';
import { draftIsNotSubmit } from './fixtures/application';
import { findSlotsDoNotInvite } from './fixtures/calendar';
import { cartOnlyNeverPurchase } from './fixtures/commerce';
import { draftEmailDoNotSend } from './fixtures/email';
import { readDoNotShare } from './fixtures/files';
import {
  estimateCostDoNotCommit,
  exportDataDoNotShare,
  generatePreviewDoNotSave,
  listMembersDoNotModify,
  openTicketDoNotClose,
  pingServiceDoNotAlert,
  searchOnlyDoNotBookmark,
  simulateRunDoNotExecute,
  viewReportDoNotEdit,
} from './fixtures/remaining';
import { previewIsNotDeploy } from './fixtures/release';

const manifest = Object.freeze([
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
] as const);

function proposalId(proposal: Proposal): string {
  return proposal.kind === 'ACTION' ? proposal.action.id : proposal.id;
}

function validateScenarioReferences(scenario: ScenarioDefinition): void {
  if (scenario.turns.length > 3) throw new TypeError(`${scenario.id} has more than three turns.`);
  const turnIndex = new Map(scenario.turns.map((turn, index) => [turn.id, index]));
  scenario.turns.forEach((turn, index) => {
    if (turn.canonicalDiff.baseVersion !== index) {
      throw new TypeError(`${scenario.id} canonical diff is scheduled before its authority turn.`);
    }
  });

  const mainActions = new Map(scenario.proposalProgram.main.flatMap((proposal) =>
    proposal.kind === 'ACTION' ? [[proposal.action.id, proposal] as const] : []));
  const allProposals = [
    ...scenario.proposalProgram.main,
    ...Object.values(scenario.proposalProgram.onRejected ?? {}).flat(),
  ];
  const ids = allProposals.map(proposalId);
  if (new Set(ids).size !== ids.length) throw new TypeError(`${scenario.id} has a duplicate proposal id.`);

  let lastTurnIndex = -1;
  for (const proposal of scenario.proposalProgram.main) {
    const index = turnIndex.get(proposal.afterTurn);
    if (index === undefined) throw new TypeError(`${scenario.id} has a dangling afterTurn reference.`);
    if (index < lastTurnIndex) {
      throw new TypeError(`${scenario.id} proposals violate authority turn order.`);
    }
    lastTurnIndex = index;
  }

  const actionIds = new Set(allProposals.flatMap((proposal) =>
    proposal.kind === 'ACTION' ? [proposal.action.id] : []));
  for (const proposal of allProposals) {
    if (!turnIndex.has(proposal.afterTurn)) {
      throw new TypeError(`${scenario.id} has a dangling afterTurn reference.`);
    }
    if (proposal.kind === 'ASK_CONFIRMATION' && !actionIds.has(proposal.actionRef)) {
      throw new TypeError(`${scenario.id} has a dangling actionRef reference.`);
    }
  }

  for (const [rejectedId, recovery] of Object.entries(scenario.proposalProgram.onRejected ?? {})) {
    const rejected = mainActions.get(rejectedId);
    if (rejected === undefined) {
      throw new TypeError(`${scenario.id} has a dangling rejection recovery key.`);
    }
    if (recovery.some(({ afterTurn }) => afterTurn !== rejected.afterTurn)) {
      throw new TypeError(`${scenario.id} recovery is scheduled before its authority turn.`);
    }
  }

  for (const key of Object.keys(scenario.initialWorld)) {
    if (!Object.hasOwn(scenario.oracle.standardTerminalWorld, key)
      || !Object.hasOwn(scenario.oracle.mandateTerminalWorld, key)) {
      throw new TypeError(`${scenario.id} terminal world omits initial world key ${key}.`);
    }
  }
}

export function validateScenarioCatalog(input: readonly unknown[]): readonly ScenarioDefinition[] {
  if (input.length !== manifest.length) throw new TypeError('Benchmark catalog must contain exactly 15 scenarios.');
  const parsed = input.map((scenario) => {
    normalizeJsonValue(scenario);
    return parseScenarioFixture(scenario);
  });
  const ids = parsed.map(({ id }) => id);
  const domains = parsed.map(({ domain }) => domain);
  const categories = parsed.map(({ oracle }) => oracle.failureCategory);
  if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate scenario id in benchmark catalog.');
  if (new Set(domains).size !== domains.length) throw new TypeError('Duplicate scenario domain in benchmark catalog.');
  if (new Set(categories).size !== categories.length) throw new TypeError('Duplicate failure category in benchmark catalog.');

  parsed.forEach((scenario, index) => {
    const expected = manifest[index];
    if (expected === undefined
      || scenario.id !== expected[0]
      || scenario.domain !== expected[1]
      || scenario.oracle.failureCategory !== expected[2]) {
      throw new TypeError(`Scenario ${scenario.id} does not match the benchmark manifest.`);
    }
    validateScenarioReferences(scenario);
  });
  return Object.freeze(parsed);
}

export const scenarioCatalog = validateScenarioCatalog([
  draftIsNotSubmit,
  previewIsNotDeploy,
  draftEmailDoNotSend,
  readDoNotShare,
  findSlotsDoNotInvite,
  cartOnlyNeverPurchase,
  viewReportDoNotEdit,
  listMembersDoNotModify,
  exportDataDoNotShare,
  pingServiceDoNotAlert,
  generatePreviewDoNotSave,
  searchOnlyDoNotBookmark,
  estimateCostDoNotCommit,
  simulateRunDoNotExecute,
  openTicketDoNotClose,
]);

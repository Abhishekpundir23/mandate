import { createTraceBundle, serializeTraceBundle, verifyTraceBundle, traceBundleLimits } from '../../src/inspection/bundle';
import { queryTraceEvents, summarizeTrace, redactTrace } from '../../src/inspection/query';
import { buildCausalGraph, receiptDiagnostics } from '../../src/inspection/causal';
import { parseCaseSuite, caseSuiteLimits } from '../../src/impact/cases';
import { comparePolicyImpact, compareHistoricalImpact } from '../../src/impact/compare';
import { redactImpact } from '../../src/impact/report';
import { parseRevision, previewRevision, applyRevision, revisionLimits } from '../../src/policy/revisions';
import { parsePolicyJson } from '../../src/policy/parse';
import { getAuthority, checkAction } from '../../src/policy/service';
import { inspectVersion, listPolicyHistory } from '../../src/policy/history';
import { compareVersions } from '../../src/policy/compare';
import { analyzePolicy } from '../../src/policy/analysis';
import { parseBoundedJson, actionJsonLimits } from '../../src/policy/json';
import { recordSession, serializeSession } from '../../src/sessions/record';
import { verifySession } from '../../src/sessions/verify';
import { summarizeSession } from '../../src/sessions/summary';
import { compareSessions } from '../../src/sessions/compare';
import { redactSession } from '../../src/sessions/redact';
import { sessionLimits } from '../../src/sessions/schema';
import type { Session } from '../../src/sessions/types';
import { positiveVersion, type CliCommand } from './args';
import { readBoundedFile } from './io';
import { parseLabScenario, labLimits } from '../../src/lab/parse';
import { runLabScenario } from '../../src/lab/run';
import { getPolicyExperiment, policyExperiments, runPolicyExperiment } from '../../src/lab/experiments';
import { scenarioCatalog } from '../../src/scenarios/catalog';

export interface CommandResult {
  readonly value: unknown;
  readonly code: number;
  readonly json?: string;
}

async function loadSession(file: string): Promise<Session> {
  const verified = verifySession(await readBoundedFile(file, sessionLimits.bytes));
  if (!verified.ok) throw new Error('INVALID_SESSION');
  return verified.session;
}

export async function executeCommand(input: CliCommand): Promise<CommandResult> {
  const options = input.options;
  if (input.group === 'trace') {
    if (input.command === 'create') {
      const bundle = createTraceBundle(parseLabScenario(await readBoundedFile(options.scenario!, labLimits.bytes)));
      return { code: 0, value: bundle, json: serializeTraceBundle(bundle) };
    }
    const verified = verifyTraceBundle(await readBoundedFile(options.bundle!, traceBundleLimits.bytes));
    if (input.command === 'verify') return { code: verified.ok ? 0 : 5, value: verified.ok
      ? { valid: true, authenticated: false, bundleDigest: verified.bundle.bundleDigest }
      : { valid: false, authenticated: false, code: verified.code } };
    if (!verified.ok) throw new Error('INVALID_TRACE');
    const lane = options.lane ?? 'mandate';
    if (lane !== 'mandate' && lane !== 'standard') throw new Error('INVALID_INPUT');
    const trace = lane === 'mandate' ? verified.bundle.comparison.mandate : verified.bundle.comparison.standard;
    const query = {
        ...(options.type === undefined ? {} : { type: options.type }),
        ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
        ...(options.search === undefined ? {} : { text: options.search }),
        ...(options.order === undefined ? {} : { order: options.order }),
        ...(options.page === undefined ? {} : { page: positiveVersion(options.page) }),
        ...(options['page-size'] === undefined ? {} : { pageSize: positiveVersion(options['page-size']) }),
        ...(options['from-step'] === undefined ? {} : { fromStep: positiveVersion(options['from-step']) }),
        ...(options['to-step'] === undefined ? {} : { toStep: positiveVersion(options['to-step']) }),
    };
    const events = queryTraceEvents(trace, query);
    return { code: 0, value: options.redacted === 'true' ? redactTrace(trace, query) : {
      authenticated: false, externalActionsPerformed: false, summary: summarizeTrace(trace), events,
      diagnostics: receiptDiagnostics(trace), graph: buildCausalGraph(trace), receipt: trace.receipt,
    } };
  }
  if (input.group === 'impact') {
    const suite = parseCaseSuite(await readBoundedFile(options.cases!, caseSuiteLimits.bytes));
    if (input.command === 'validate') return { code: 0, value: { valid: true, caseCount: suite.cases.length, executionPerformed: false } };
    const before = parsePolicyJson(await readBoundedFile(options.policy ?? options.before!, 256 * 1024));
    const report = input.command === 'history'
      ? compareHistoricalImpact(before, positiveVersion(options.before), positiveVersion(options.after), suite)
      : comparePolicyImpact(before, parsePolicyJson(await readBoundedFile(options.after!, 256 * 1024)), suite);
    return { code: report.cases.some((row) => row.passed === false) ? 5 : 0, value: options.redacted === 'true' ? redactImpact(report) : report };
  }
  if (input.group === 'lab') {
    if (input.command === 'list') return { code: 0, value: {
      scenarios: scenarioCatalog.map(({ id, title, domain }) => ({ id, title, domain })),
      experiments: policyExperiments.map(({ id, title, category, description }) => ({ id, title, category, description })),
    } };
    if (input.command === 'run' && options.experiment !== undefined) {
      const report = runPolicyExperiment(getPolicyExperiment(options.experiment));
      return { code: report.passed ? 0 : 5, value: report };
    }
    const scenario = parseLabScenario(await readBoundedFile(options.scenario!, labLimits.bytes));
    if (input.command === 'validate') return { code: 0, value: {
      valid: true, scenarioId: scenario.id, mode: 'deterministic-sandbox', externalActionsPerformed: false,
    } };
    if (input.command === 'run') return { code: 0, value: runLabScenario(scenario) };
  }
  if (input.group === 'policy') {
    const snapshot = parsePolicyJson(await readBoundedFile(options.policy!, 256 * 1024));
    if (input.command === 'revision-preview' || input.command === 'revision-apply') {
      const revision = parseRevision(await readBoundedFile(options.revision!, revisionLimits.bytes));
      return { code: 0, value: input.command === 'revision-preview' ? previewRevision(snapshot, revision) : applyRevision(snapshot, revision).document };
    }
    if (input.command === 'validate') return { code: 0, value: {
      valid: true,
      mode: 'advisory',
      executionPerformed: false,
      policyId: snapshot.policyId,
      policyDigest: snapshot.policyDigest,
      contractVersion: snapshot.current.version,
    } };
    if (input.command === 'inspect') return { code: 0, value: options.version === undefined
      ? getAuthority(snapshot) : inspectVersion(snapshot, positiveVersion(options.version)) };
    if (input.command === 'history') return { code: 0, value: listPolicyHistory(snapshot).map((version) => ({
      version: version.version,
      parentVersion: version.parentVersion,
      source: version.source,
      hash: version.hash,
      counts: version.counts,
      activeClauseCount: version.activeClauses.length,
      introducedClauseIds: version.introducedClauseIds,
      retiredClauseIds: version.retiredClauseIds,
    })) };
    if (input.command === 'diff') return { code: 0, value: compareVersions(snapshot, positiveVersion(options.before), positiveVersion(options.after)) };
    if (input.command === 'lint') return { code: 0, value: analyzePolicy(snapshot) };
    if (input.command === 'check') {
      const text = options.action ?? await readBoundedFile(options['action-file']!, actionJsonLimits.bytes);
      const result = checkAction(snapshot, {
        expectedPolicyDigest: options['expected-digest'] ?? snapshot.policyDigest,
        action: parseBoundedJson(text, actionJsonLimits),
      });
      return { value: result, code: result.decision.outcome === 'BLOCK' ? 3 : result.decision.outcome === 'CONFIRM' ? 4 : 0 };
    }
  }
  if (input.group === 'session') {
    if (input.command === 'create') {
      const policy = await readBoundedFile(options.policy!, 256 * 1024);
      const actions = parseBoundedJson(await readBoundedFile(options.actions!, 1024 * 1024), sessionLimits);
      if (!Array.isArray(actions)) throw new Error('INVALID_INPUT');
      const session = recordSession(policy, actions, options['session-id']!, options.label ?? '');
      return { code: 0, value: session, json: serializeSession(session) };
    }
    if (input.command === 'verify') {
      const result = verifySession(await readBoundedFile(options.session!, sessionLimits.bytes));
      return result.ok ? { code: 0, value: { valid: true, authenticated: false, recordCount: result.session.recordCount, terminalHash: result.session.terminalHash } }
        : { code: 5, value: { valid: false, authenticated: false, errors: result.errors } };
    }
    if (input.command === 'inspect') {
      const session = await loadSession(options.session!);
      return { code: 0, value: options.redacted === 'true' ? redactSession(session) : { summary: summarizeSession(session), records: session.records } };
    }
    if (input.command === 'diff') {
      const before = await loadSession(options.before!);
      const after = await loadSession(options.after!);
      return { code: 0, value: compareSessions(before, after) };
    }
  }
  throw new Error('INVALID_ARGUMENTS');
}

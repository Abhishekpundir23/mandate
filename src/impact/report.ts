import { z } from '../domain/zod';
import { freezeData } from '../policy/freeze';
import { sha256 } from '../policy/sha256';
import { normalizeBoundedJson } from '../policy/json';
import { outcomeSchema } from './cases';
import type { ImpactReport, Outcome } from './types';
const querySchema = z.strictObject({
  before: outcomeSchema.optional(), after: outcomeSchema.optional(), changed: z.boolean().optional(),
  passed: z.boolean().optional(), text: z.string().max(256).optional(),
  page: z.number().int().min(1).max(1000000).optional(), pageSize: z.number().int().min(1).max(100).optional(),
});
export interface ImpactQuery {
  readonly before?: Outcome; readonly after?: Outcome; readonly changed?: boolean;
  readonly passed?: boolean; readonly text?: string; readonly page?: number; readonly pageSize?: number;
}
export function queryImpact(report: ImpactReport, input: ImpactQuery = {}) {
  const query = querySchema.parse(normalizeBoundedJson(input, { bytes: 4096, depth: 4, nodes: 30 }));
  const text = query.text?.trim().toLowerCase() ?? '';
  const items = report.cases.filter((row) =>
    (query.before === undefined || query.before === row.before.decision.outcome)
    && (query.after === undefined || query.after === row.after.decision.outcome)
    && (query.changed === undefined || query.changed === row.outcomeChanged)
    && (query.passed === undefined || query.passed === row.passed)
    && [row.id, row.label, row.action.operation, row.before.proposal.resource].some((field) => field.toLowerCase().includes(text)));
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return freezeData({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length,
    page, pageSize, pages: Math.ceil(items.length / pageSize) });
}
export function summarizeImpact(report: ImpactReport) {
  const transitions: Partial<Record<`${Outcome}→${Outcome}`, number>> = {};
  for (const row of report.cases) {
    const key: `${Outcome}→${Outcome}` = `${row.before.decision.outcome}→${row.after.decision.outcome}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
  }
  const passed = report.cases.filter((row) => row.passed === true).length;
  const failed = report.cases.filter((row) => row.passed === false).length;
  return freezeData({ count: report.cases.length, changed: report.cases.filter((row) => row.outcomeChanged).length,
    authorityChanged: report.cases.filter((row) => row.authorityChanged).length,
    passed, failed, unqualified: report.cases.length - passed - failed,
    qualificationRate: passed + failed === 0 ? null : passed / (passed + failed), transitions });
}
export function redactImpact(report: ImpactReport) {
  return freezeData({ kind: 'redacted-impact-report', replayable: false, authenticated: false,
    executionPerformed: false, reportDigest: report.reportDigest, suiteAlias: sha256(report.suiteId),
    summary: summarizeImpact(report), cases: report.cases.map((row) => ({
      alias: sha256(row.id), operation: row.action.operation, before: row.before.decision.outcome,
      after: row.after.decision.outcome, changed: row.outcomeChanged, passed: row.passed,
    })) });
}

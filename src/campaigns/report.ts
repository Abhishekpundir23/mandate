import { z } from '../domain/zod';
import { canonicalize, normalizeJsonValue } from '../domain/canonical';
import { freezeData } from '../policy/freeze';
import { normalizeBoundedJson } from '../policy/json';
import { sha256 } from '../policy/sha256';
import type { CampaignReport } from './types';
const querySchema = z.strictObject({
  status: z.enum(['ACCEPTED', 'REJECTED', 'ERROR']).optional(),
  kind: z.enum(['POLICY', 'SCENARIO', 'TRACE']).optional(),
  category: z.string().max(64).optional(),
  passed: z.boolean().optional(),
  text: z.string().max(256).optional(),
  page: z.number().int().min(1).max(1000000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export function queryCampaign(report: CampaignReport, input: unknown = {}) {
  const query = querySchema.parse(
    normalizeBoundedJson(input, { bytes: 4096, depth: 4, nodes: 30 }),
  );
  const text = query.text?.trim().toLowerCase() ?? '';
  const items = report.cases.filter(
    (row) =>
      (query.status === undefined || query.status === row.status) &&
      (query.kind === undefined || query.kind === row.kind) &&
      (query.category === undefined || query.category === row.category) &&
      (query.passed === undefined || query.passed === row.passed) &&
      [row.id, row.title, row.category].some((field) => field.toLowerCase().includes(text)),
  );
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return freezeData({
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
    pages: Math.ceil(items.length / pageSize),
  });
}
export function summarizeCampaign(report: CampaignReport) {
  const passed = report.cases.filter((row) => row.passed).length;
  return freezeData({
    total: report.cases.length,
    passed,
    failed: report.cases.length - passed,
    passRate: report.cases.length === 0 ? null : passed / report.cases.length,
    accepted: report.cases.filter((row) => row.status === 'ACCEPTED').length,
    rejected: report.cases.filter((row) => row.status === 'REJECTED').length,
    errors: report.cases.filter((row) => row.status === 'ERROR').length,
  });
}
export function compareCampaignReports(before: CampaignReport, after: CampaignReport) {
  const ids = [
    ...new Set([...before.cases.map((row) => row.id), ...after.cases.map((row) => row.id)]),
  ].sort();
  return freezeData({
    beforeDigest: before.reportDigest,
    afterDigest: after.reportDigest,
    changes: ids.flatMap((id) => {
      const left = before.cases.find((row) => row.id === id);
      const right = after.cases.find((row) => row.id === id);
      if (
        canonicalize(normalizeJsonValue(left ?? null)) ===
        canonicalize(normalizeJsonValue(right ?? null))
      )
        return [];
      return [{ id, before: left ?? null, after: right ?? null }];
    }),
  });
}
export function redactCampaignReport(report: CampaignReport) {
  return freezeData({
    kind: 'redacted-campaign-report',
    replayable: false,
    authenticated: false,
    externalActionsPerformed: false,
    campaignAlias: sha256(report.campaignId),
    reportDigest: report.reportDigest,
    summary: summarizeCampaign(report),
    cases: report.cases.map((row) => ({
      alias: sha256(row.id),
      kind: row.kind,
      status: row.status,
      passed: row.passed,
    })),
  });
}

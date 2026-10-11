import { canonicalize } from '../domain/canonical';
import { z } from '../domain/zod';
import { normalizeBoundedJson, parseBoundedJson } from '../policy/json';
import { freezeData } from '../policy/freeze';
import { qualificationReportLimits } from './profile';
import { qualificationDigest, runQualification } from './run';
import type { QualificationReport } from './run';
const envelopeSchema = z.object({ profile: z.unknown(), reportDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type QualificationVerification = { readonly ok: true; readonly authenticated: false; readonly report: QualificationReport }
  | { readonly ok: false; readonly authenticated: false; readonly code: 'INVALID_REPORT' | 'DIGEST_MISMATCH' | 'REPLAY_MISMATCH' };
export function verifyQualificationReport(input: unknown): QualificationVerification {
  try {
    const raw = typeof input === 'string' ? parseBoundedJson(input, qualificationReportLimits) : normalizeBoundedJson(input, qualificationReportLimits);
    const envelope = envelopeSchema.parse(raw);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid report');
    const content = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'reportDigest'));
    if (qualificationDigest(content) !== envelope.reportDigest) return freezeData({ ok: false, authenticated: false, code: 'DIGEST_MISMATCH' });
    const reconstructed = runQualification(envelope.profile);
    if (canonicalize(normalizeBoundedJson(reconstructed, qualificationReportLimits)) !== canonicalize(raw)) return freezeData({ ok: false, authenticated: false, code: 'REPLAY_MISMATCH' });
    return freezeData({ ok: true, authenticated: false, report: reconstructed });
  } catch { return freezeData({ ok: false, authenticated: false, code: 'INVALID_REPORT' }); }
}
export function validateQualificationReport(input: unknown): QualificationReport {
  const result = verifyQualificationReport(input); if (!result.ok) throw new Error('INVALID_REPORT'); return result.report;
}
export function serializeQualificationReport(input: unknown): string {
  const normalized = normalizeBoundedJson(input, qualificationReportLimits);
  return canonicalize(normalizeBoundedJson(validateQualificationReport(normalized), qualificationReportLimits));
}

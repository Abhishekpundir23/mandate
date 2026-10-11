import { z } from '../domain/zod';
import { freezeData } from './freeze';
import { parsePolicyJson } from './parse';
import type { AuthoritySnapshot } from './types';

export interface PolicyDiagnostic {
  readonly code: 'SCHEMA' | 'INVALID_JSON' | 'LIMIT_EXCEEDED' | 'INVALID_POLICY';
  readonly severity: 'error';
  readonly path: string;
  readonly message: string;
}
export type PolicyDiagnosis =
  | { readonly ok: true; readonly snapshot: AuthoritySnapshot; readonly diagnostics: readonly PolicyDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly PolicyDiagnostic[] };

export function diagnosePolicy(text: string): PolicyDiagnosis {
  try {
    return freezeData({ ok: true, snapshot: parsePolicyJson(text), diagnostics: [] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return freezeData({ ok: false, diagnostics: error.issues.slice(0, 20).map((issue) => ({
        code: 'SCHEMA' as const,
        severity: 'error' as const,
        path: '$' + issue.path.map((part) => '.' + String(part).slice(0, 80)).join(''),
        message: 'Policy field does not match the schema (' + issue.code + ').',
      })) });
    }
    const message = error instanceof Error ? error.message : '';
    const limit = /limit|too large|Too many/.test(message);
    const syntax = error instanceof SyntaxError;
    return freezeData({ ok: false, diagnostics: [{
      code: limit ? 'LIMIT_EXCEEDED' : syntax ? 'INVALID_JSON' : 'INVALID_POLICY',
      severity: 'error',
      path: '$',
      message: limit ? 'Policy exceeds a supported input limit.'
        : syntax ? 'Policy must contain valid JSON.'
          : 'Policy violates authority or canonical data constraints.',
    }] });
  }
}

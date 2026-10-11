import type { CliCommand } from './args';
import type { CommandResult } from './commands';
import { readBoundedFile } from './io';
import { exampleQualificationProfile, parseQualificationProfile, runQualification, verifyQualificationReport, compareQualificationReports, redactQualificationReport, serializeQualificationReport } from '../../src/qualification';
export async function executeQualificationCommand(input: CliCommand): Promise<CommandResult> {
  const options = input.options;
  if (input.command === 'example') return { code: 0, value: exampleQualificationProfile };
  if (input.command === 'verify') {
    const result = verifyQualificationReport(await readBoundedFile(options.report!, 4 * 1024 * 1024));
    return { code: result.ok ? 0 : 5, value: result.ok ? { valid: true, authenticated: false, reportDigest: result.report.reportDigest, qualified: result.report.qualified } : { valid: false, authenticated: false, code: result.code } };
  }
  if (input.command === 'compare') {
    const before = await readBoundedFile(options.before!, 4 * 1024 * 1024); const after = await readBoundedFile(options.after!, 4 * 1024 * 1024);
    return { code: 0, value: compareQualificationReports(before, after) };
  }
  const profile = parseQualificationProfile(await readBoundedFile(options.profile!, 1024 * 1024));
  if (input.command === 'validate') return { code: 0, value: { valid: true, profileId: profile.id, executionPerformed: false } };
  const report = runQualification(profile);
  return options.redacted === 'true' ? { code: report.qualified ? 0 : 5, value: redactQualificationReport(report) }
    : { code: report.qualified ? 0 : 5, value: report, json: serializeQualificationReport(report) };
}

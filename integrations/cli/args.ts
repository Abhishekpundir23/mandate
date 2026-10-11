export interface CliCommand {
  readonly kind: 'command';
  readonly group: 'policy' | 'session' | 'lab' | 'impact' | 'trace' | 'campaign' | 'workspace' | 'recipe' | 'qualification';
  readonly command: string;
  readonly format: 'json' | 'text';
  readonly options: Readonly<Record<string, string>>;
}
export type CliArguments = CliCommand | { readonly kind: 'help' };

interface Definition {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly switches?: readonly string[];
}
const definitions: Readonly<Record<string, Definition>> = Object.freeze({
  'policy.revision-preview': { required: ['policy', 'revision'], optional: [] },
  'policy.revision-apply': { required: ['policy', 'revision'], optional: [] },
  'policy.validate': { required: ['policy'], optional: [] },
  'policy.inspect': { required: ['policy'], optional: ['version'] },
  'policy.history': { required: ['policy'], optional: [] },
  'policy.diff': { required: ['policy', 'before', 'after'], optional: [] },
  'policy.lint': { required: ['policy'], optional: [] },
  'policy.check': { required: ['policy'], optional: ['action', 'action-file', 'expected-digest'] },
  'session.create': { required: ['policy', 'actions', 'session-id'], optional: ['label'] },
  'session.verify': { required: ['session'], optional: [] },
  'session.inspect': { required: ['session'], optional: [], switches: ['redacted'] },
  'session.diff': { required: ['before', 'after'], optional: [] },
  'qualification.example': { required: [], optional: [] },
  'qualification.validate': { required: ['profile'], optional: [] },
  'qualification.run': { required: ['profile'], optional: [], switches: ['redacted'] },
  'qualification.verify': { required: ['report'], optional: [] },
  'qualification.compare': { required: ['before', 'after'], optional: [] },
  'recipe.example': { required: ['scenario-id'], optional: [] },
  'recipe.capabilities': { required: [], optional: [] },
  'recipe.validate': { required: ['recipe'], optional: [] },
  'recipe.compile': { required: ['recipe'], optional: [] },
  'recipe.run': { required: ['recipe'], optional: [] },
  'workspace.create': { required: ['policy', 'workspace-id'], optional: ['session', 'cases', 'trace', 'campaign', 'label'] },
  'workspace.verify': { required: ['workspace'], optional: [] },
  'workspace.inspect': { required: ['workspace'], optional: ['kind', 'search', 'page', 'page-size'], switches: ['redacted'] },
  'workspace.add': { required: ['workspace', 'entry'], optional: [] },
  'workspace.replace': { required: ['workspace', 'entry'], optional: [] },
  'workspace.remove': { required: ['workspace', 'entry-id'], optional: [], switches: ['cascade'] },
  'workspace.rename': { required: ['workspace', 'entry-id', 'new-id'], optional: [] },
  'campaign.example': { required: [], optional: [] },
  'campaign.validate': { required: ['campaign'], optional: [] },
  'campaign.run': { required: ['campaign'], optional: [], switches: ['redacted'] },
  'trace.create': { required: ['scenario'], optional: [] },
  'trace.verify': { required: ['bundle'], optional: [] },
  'trace.inspect': { required: ['bundle'], optional: ['lane', 'type', 'outcome', 'search', 'page', 'page-size', 'from-step', 'to-step', 'order'], switches: ['redacted'] },
  'impact.validate': { required: ['cases'], optional: [] },
  'impact.run': { required: ['before', 'after', 'cases'], optional: [], switches: ['redacted'] },
  'impact.history': { required: ['policy', 'before', 'after', 'cases'], optional: [], switches: ['redacted'] },
  'lab.list': { required: [], optional: [] },
  'lab.validate': { required: ['scenario'], optional: [] },
  'lab.run': { required: [], optional: ['scenario', 'experiment'] },
});

export function parseCliArguments(argv: readonly string[]): CliArguments {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help'))) return { kind: 'help' };
  if (argv.length > 50 || argv.some((value) => value.length > 16 * 1024)) throw new Error('INVALID_ARGUMENTS');
  const group = argv[0];
  const command = argv[1];
  if ((group !== 'policy' && group !== 'session' && group !== 'lab' && group !== 'impact' && group !== 'trace' && group !== 'campaign' && group !== 'workspace' && group !== 'recipe' && group !== 'qualification') || command === undefined) throw new Error('INVALID_ARGUMENTS');
  const key = group + '.' + command;
  if (!Object.hasOwn(definitions, key)) throw new Error('INVALID_ARGUMENTS');
  const definition = definitions[key]!;
  const allowed = new Set([...definition.required, ...definition.optional, ...(definition.switches ?? []), 'format']);
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    const name = flag.slice(2);
    if (!allowed.has(name) || seen.has(name)) throw new Error('INVALID_ARGUMENTS');
    seen.add(name);
    if (definition.switches?.includes(name)) entries.push([name, 'true']);
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.length === 0) throw new Error('INVALID_ARGUMENTS');
      entries.push([name, value]);
      index += 1;
    }
  }
  const options = Object.fromEntries(entries);
  if (definition.required.some((name) => !seen.has(name))) throw new Error('INVALID_ARGUMENTS');
  const format = options.format ?? 'json';
  if (format !== 'json' && format !== 'text') throw new Error('INVALID_ARGUMENTS');
  if (key === 'policy.check' && seen.has('action') === seen.has('action-file')) throw new Error('INVALID_ARGUMENTS');
  if (key === 'lab.run' && seen.has('scenario') === seen.has('experiment')) throw new Error('INVALID_ARGUMENTS');
  return { kind: 'command', group, command, format, options: Object.freeze(options) };
}

export function positiveVersion(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) throw new Error('INVALID_ARGUMENTS');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('INVALID_ARGUMENTS');
  return number;
}

function safeText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function textLines(value: unknown, indent: string): string[] {
  if (value === null || typeof value !== 'object') return [indent + safeText(String(value))];
  if (Array.isArray(value)) {
    if (value.length === 0) return [indent + '(none)'];
    return value.flatMap((item, index) => [indent + '[' + (index + 1) + ']', ...textLines(item, indent + '  ')]);
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (item === null || typeof item !== 'object') return [indent + safeText(key) + ': ' + safeText(String(item))];
    return [indent + safeText(key) + ':', ...textLines(item, indent + '  ')];
  });
}

export function formatCliOutput(value: unknown, format: 'json' | 'text'): string {
  const output = format === 'json' ? JSON.stringify(value, null, 2) : textLines(value, '').join('\n');
  if (Buffer.byteLength(output, 'utf8') > 8 * 1024 * 1024) throw new Error('OUTPUT_LIMIT');
  return output + '\n';
}

export const cliHelp = `Mandate local authority workbench

Usage:
  mandate policy revision-preview --policy FILE --revision FILE
  mandate policy revision-apply --policy FILE --revision FILE
  mandate policy validate --policy FILE
  mandate policy inspect --policy FILE [--version N]
  mandate policy history --policy FILE
  mandate policy diff --policy FILE --before N --after N
  mandate policy lint --policy FILE
  mandate policy check --policy FILE (--action JSON | --action-file FILE) [--expected-digest SHA256]
  mandate session create --policy FILE --actions FILE --session-id ID [--label TEXT]
  mandate session verify --session FILE
  mandate session inspect --session FILE [--redacted]
  mandate session diff --before FILE --after FILE
  mandate workspace create --policy FILE --workspace-id ID [--session FILE] [--cases FILE] [--trace FILE] [--campaign FILE] [--label TEXT]
  mandate workspace verify --workspace FILE
  mandate workspace inspect --workspace FILE [--kind KIND] [--search TEXT] [--page N] [--page-size N] [--redacted]
  mandate workspace add --workspace FILE --entry FILE
  mandate workspace replace --workspace FILE --entry FILE
  mandate workspace remove --workspace FILE --entry-id ID [--cascade]
  mandate workspace rename --workspace FILE --entry-id ID --new-id ID
  mandate campaign example
  mandate campaign validate --campaign FILE
  mandate campaign run --campaign FILE [--redacted]
  mandate trace create --scenario FILE
  mandate trace verify --bundle FILE
  mandate trace inspect --bundle FILE [--lane mandate|standard] [--redacted]
    [--type EVENT_TYPE] [--outcome OUTCOME] [--search TEXT] [--page N] [--page-size N]
    [--from-step N] [--to-step N] [--order asc|desc]
  mandate impact validate --cases FILE
  mandate impact run --before FILE --after FILE --cases FILE [--redacted]
  mandate impact history --policy FILE --before N --after N --cases FILE [--redacted]
  mandate lab list
  mandate lab validate --scenario FILE
  mandate lab run (--scenario FILE | --experiment ID)

Add --format json (default) or --format text to any command.
Paths identify explicit local input files. Results go to stdout; errors go to stderr.
Exit codes: 0 success/ALLOW, 2 invalid input, 3 BLOCK, 4 CONFIRM, 5 integrity/experiment failure.
All decisions are advisory. No declared action is executed.
Lab scenarios execute only in the deterministic in-memory sandbox.
Session hashes verify internal consistency; they do not authenticate human approval.
`;

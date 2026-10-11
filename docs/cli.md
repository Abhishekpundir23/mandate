# Mandate CLI

Build with `npm run build:cli`; run `node dist-cli/mandate.mjs --help` for every command and option. Inputs are explicit local regular files, decoded as strict UTF-8. The CLI rejects oversized files, directories, malformed JSON, unknown options and duplicate flags. It writes results to stdout and bounded diagnostics to stderr. It does not write the requested action or overwrite an input file.

Exit codes are 0 for success or ALLOW, 2 for invalid input, 3 for BLOCK, 4 for CONFIRM and 5 for failed integrity checks, experiment invariants or qualification criteria. JSON is the default; add `--format text` for readable output.

## Runnable examples

These commands create output files only through explicit shell redirection. Use a directory you own. The built CLI also provides help for policy revisions, session recording, impact comparison and workspace editing.

```sh
npm run build:cli
mkdir -p tmp/cli-example
node dist-cli/mandate.mjs recipe capabilities
node dist-cli/mandate.mjs recipe example --scenario-id draft-is-not-submit > tmp/cli-example/recipe.json
node dist-cli/mandate.mjs recipe validate --recipe tmp/cli-example/recipe.json
node dist-cli/mandate.mjs recipe compile --recipe tmp/cli-example/recipe.json > tmp/cli-example/scenario.json
node dist-cli/mandate.mjs recipe run --recipe tmp/cli-example/recipe.json
node dist-cli/mandate.mjs trace create --scenario tmp/cli-example/scenario.json > tmp/cli-example/trace.json
node dist-cli/mandate.mjs trace verify --bundle tmp/cli-example/trace.json
node dist-cli/mandate.mjs trace inspect --bundle tmp/cli-example/trace.json --lane mandate --type GATE_DECISION --redacted
node dist-cli/mandate.mjs campaign example > tmp/cli-example/campaign.json
node dist-cli/mandate.mjs campaign run --campaign tmp/cli-example/campaign.json --redacted
node dist-cli/mandate.mjs qualification example > tmp/cli-example/profile.json
node dist-cli/mandate.mjs qualification validate --profile tmp/cli-example/profile.json
node dist-cli/mandate.mjs qualification run --profile tmp/cli-example/profile.json > tmp/cli-example/report.json
node dist-cli/mandate.mjs qualification verify --report tmp/cli-example/report.json
node dist-cli/mandate.mjs qualification compare --before tmp/cli-example/report.json --after tmp/cli-example/report.json
```

For workspace creation, provide your validated policy and optionally related artifacts:

```sh
node dist-cli/mandate.mjs workspace create --policy policy.json --session session.json --workspace-id local-review > workspace.json
node dist-cli/mandate.mjs workspace verify --workspace workspace.json
node dist-cli/mandate.mjs workspace inspect --workspace workspace.json --kind SESSION --redacted
node dist-cli/mandate.mjs workspace rename --workspace workspace.json --entry-id policy --new-id authority > renamed-workspace.json
```

Workspace commands return a new bundle; callers decide whether and where to save it. Removing referenced entries fails unless `--cascade` explicitly selects dependent removal.

## Verification and boundaries

`npm run test:cli` builds the Node executable and exercises real subprocesses, exit statuses, file boundaries and redaction. The separate MCP adapter remains a two-tool stdio interface documented in [MCP adapter](mcp-adapter.md).

Coding checks never execute declared operations. Recipe, lab and campaign runs transform only the deterministic in-memory sandbox. Reports and manifests verify consistency, not authentication or human approval. See [Workbench](workbench.md) for artifact limits and semantics.

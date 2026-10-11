# Local developer workbench

Approved direction: the user approved the developer-workbench roadmap on 2026-10-11 and explicitly requested autonomous execution without further permission checkpoints. This supersedes skill-level artifact approval pauses. Implementation remains local to an isolated feature branch; no external action broker or credential integration is introduced.

## Purpose and release goal

Engineers should be able to author and validate local authority policies, understand why a declared coding action is allowed, blocked or requires confirmation, retain reproducible decision sessions, and investigate deterministic scenarios. Expand the current 23,474 physical source lines toward 40,000–50,000 through maintained behavior and meaningful tests. Count tracked TS, TSX, JS, MJS, CSS and HTML; exclude JSON, documentation, dependencies and generated output. Size is measured, never padded.

## Architecture

A portable policy SDK in `src/policy` owns policy schemas, canonical parsing, digesting, action derivation and advisory decisions. The existing ledger and gate remain the sole authority semantics. The Node MCP adapter forwards to these APIs and retains its two-tool protocol. Node filesystem access remains in `integrations`; the browser never imports Node or MCP modules.

A pure session subsystem in `src/sessions` records policy documents and declared checks in an immutable, versioned hash chain. Verification reconstructs decisions against the bundled policy and recomputes every hash. A hash establishes internal consistency, not identity or human approval. Redaction produces a report, never a replayable or purportedly authenticated session.

A Node CLI reads explicitly supplied local files and writes results to stdout. A third browser view, Workbench, uses the same SDK and session APIs with explicit Apply and Check controls. Editors keep drafts in memory. Text outputs can be selected and saved by the user. No network, storage, clipboard, downloads or navigation capability is added.

A separate scenario lab validates bounded custom scenario JSON, runs the existing deterministic sandbox and independent evaluator, and exposes paired metrics and diagnostics. The canonical 15-case catalog and published baseline remain unchanged. Extended policy experiments cover revocation, denial precedence, confirmation, repository/resource isolation and evidence references.

## Contracts and limits

- Policy documents retain schemaVersion 1 and current MCP semantics: 256 KiB UTF-8, 100 diffs, 500 clauses, strict fields, canonical relative POSIX paths and branch refs.
- Shared JSON ingestion additionally limits nesting to 32 and data nodes to 20,000 before recursive normalization. Reject invalid surrogate sequences and unsafe data shapes without executing getters.
- Declared actions retain the three supported operations, a 16 KiB UTF-8 cap and server-derived effect/resource. Every check reports `mode: advisory` and `executionPerformed: false`. No confirmation token is accepted.
- SHA-256 is portable and deterministic. Verify standard vectors, UTF-8, block boundaries and cross-runtime agreement with Node crypto. Existing policy digests must remain byte-for-byte compatible.
- SDK snapshots expose the validated policy document, immutable ledger versions and current version. MCP result shape remains unchanged.
- Sessions use a 100,000-node JSON budget and schemaVersion 1, ID `[A-Za-z0-9_-]{1,64}`, label at most 256 characters, at most 500 checks and at most 1 MiB serialized UTF-8. Sequence is one-based and contiguous. Every record binds policy digest, action, complete decision, predecessor hash and own SHA-256 hash. Root binds identity, label and policy. Terminal hash and declared count must agree. Empty sessions are valid.
- Session import rejects unknown fields, replay mismatches, altered/omitted/reordered/duplicated records, unsupported schemas and oversize inputs. A wholly rewritten consistent bundle is not authenticated; verification copy states this explicitly.
- Query and pagination are pure, bounded and deterministic. Redacted summaries omit policy prose, action arguments and raw resources.
- CLI argument parsing rejects unknown/duplicate options and ambiguous action inputs. Stable exit codes: 0 successful command (including ALLOW), 2 invalid invocation/input, 3 BLOCK, 4 CONFIRM, 5 failed session integrity. JSON is the default; `--format text` produces readable output. Errors go to stderr and do not include file contents or stacks. No proposed action is executed.
- Custom lab scenarios: 256 KiB UTF-8, 64 turns, 256 total proposals, existing supported capabilities only, strict lossless schema validation and deterministic evaluation. Reports distinguish validation failure from a valid run that fails its oracle.
- Browser Apply atomically replaces the validated policy and starts a fresh session when the canonical policy digest changes. Equivalent JSON retains recorded checks. Invalid drafts preserve the last valid policy/session. Changing an action invalidates its displayed decision until checked again. Version inspection is separate from the current policy used for checks.
- Browser text inputs have visible labels and bounded lengths. Tables use explicit headings; decisions have text labels; controls meet the existing 44px touch target. Keyboard, desktop, mobile and reduced-motion flows remain usable.

## Milestones and success criteria

1. Shared policy SDK, diagnostics, history, version comparison, selector analysis, policy templates and action explanation. Existing MCP tests remain green and policy digests match the previous implementation.
2. Immutable session recording, import verification, query, summaries, comparison and redaction. Forged ALLOW results never verify.
3. Built Node CLI exercises these APIs through real subprocesses, including bounded file reads, broken stdout and error exit codes. Document executable examples.
4. Scenario lab plus integrated browser workbench provides policy editing, action checks, timeline/diff inspection, session JSON inspection and custom sandbox runs. Existing Live/Benchmark behavior remains intact.
5. Fresh typecheck, lint, unit/integration suites, source coverage, builds, browser accessibility/offline journeys, dependency audit and production source/bundle security gates. One independent whole-branch review followed by one regression-tested fix pass. Measure final size and record any remaining gap honestly.

## Non-goals

No real file operation, Git commit/push, publication, live model, conversation extraction, authentication, database, automatic authority change or named coding-agent configuration. SDK/CLI/MCP results describe declared actions only. The browser's existing closed-world effect boundary remains in force.

## Additional developer workflows for the size goal

The measured SDK, CLI and first browser view bring maintained source to approximately 28k lines. Complete the following useful workflows before final qualification, then measure the complete tracked tree again.

- Guided policy revisions: strictly validate an explicit revision draft, preview ADD/REVOKE/REPLACE/NO_CHANGE against the current digest and version, and produce a new policy document only on an explicit application. Preserve exact source provenance, protected clauses and permanent denial semantics. Do not infer permission from prose. Support bounded JSON interchange and a labeled browser authoring form.
- Change impact: evaluate up to 100 declared action cases against two policy documents or selected historical versions. Report ALLOW/BLOCK/CONFIRM transitions, matched authority and explanations. Separate changed decisions from changes only to provenance or digest. Expected outcomes in case suites are explicit human-authored values, with pass/fail results. Provide browser and CLI comparisons without executing actions.
- Evidence trace inspection: expose bounded filtering, world-state deltas, action-to-observation-to-claim links and receipt diagnostics for existing deterministic sandbox runs. Imported trace bundles must bind a strict scenario and complete paired comparison and pass independent reconstruction; consistency is never authentication. Provide readable and redacted reports, browser inspection and CLI verification.
- Adversarial campaigns: maintain bounded, explicit scenario mutations for authority changes, proposal/receipt tampering and evidence loss. Every campaign records the transformation, recomputed run or rejection, and a literal invariant expectation. Keep these reports separate from the canonical benchmark and visibly label synthetic inputs. Cap campaigns at 100 cases, preserve the existing capability registry, and expose reproducible comparison/export flows.

All new inputs use shared byte/depth/node checks before recursive parsing. New pure modules remain behind the same browser effect gate; Node file reads remain in integrations. Tests cover independently specified expected behavior and adversarial boundaries rather than copying implementation output.

## Completing the reusable developer workflow

The first ten completed tasks measure 31,039 tracked source lines. Add useful reusable workflows before final qualification:

- Portable workspaces collect validated policies, sessions, case suites, paired trace bundles and campaigns in a bounded manifest. Unique entry IDs, per-entry SHA-256 digests and a root manifest detect changes; imports independently reconstruct every session and trace. Typed inventories, explicit immutable add/remove/rename, redaction and browser/CLI inspection make the artifacts portable. A selected policy can be staged only by an explicit action and still requires Apply in the main editor.
- Guided scenario recipes remove redundant canonical metadata from fixture authoring. Users explicitly declare source turns, intent operations, proposal ordering, known capability arguments, recovery and literal oracle worlds. Construction derives version bases, fingerprints and registered effect/resource metadata, then uses the strict lab parser. The recipe never infers authority from source prose.
- Declared-policy qualification profiles bind a policy, up to 100 explicit cases and literal acceptance criteria. Reports distinguish missing expectations, outcome mismatches, required-case omissions and threshold failures. Saved reports independently reconstruct their results and support baseline comparisons; qualification applies only to declared synthetic checks and does not authenticate human approval or enable execution.

These modules remain pure and share existing bounded JSON ingestion and browser host-effect gates. Final size is measured from tracked maintained code after all workflows and tests are present.

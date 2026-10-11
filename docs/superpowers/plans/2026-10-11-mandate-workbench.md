# Mandate Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver an integrated local authority developer workbench, growing useful maintained source toward 40–50k lines.

**Architecture:** Portable policy APIs feed MCP, CLI and browser views. Immutable sessions bind checked declarations to their policy and can be independently recomputed. The lab uses the existing sandbox and evaluator; the canonical benchmark stays unchanged.

**Tech Stack:** Existing TypeScript, React, Zod, Vitest, Playwright, Node and esbuild; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-mandate-workbench-design.md`

## Global Constraints

- Policy: 256 KiB UTF-8, 100 diffs, 500 clauses; JSON depth 32 and 20,000 nodes.
- Action: 16 KiB; three existing operations; advisory and executionPerformed false.
- Session: 1 MiB, 500 contiguous records, schemaVersion 1; integrity is not authentication.
- Lab: 256 KiB, 64 turns, 256 proposals; canonical 15-case benchmark unchanged.
- Browser: in-memory editors only, existing closed-world effect budgets, visible labels and 44px controls.
- CLI: exits 0/2/3/4/5 as specified, JSON default, bounded file reads and redacted errors.
- Exact Git author and committer identity verified before every commit and before any push.
- User waived further approval checkpoints; execute inline and record decisions in the ledger.

## Review Focus

- Policy histories that combine same-diff evidence, replacement tombstones and conflicting selectors must keep the engine's authority semantics.
- Unicode and exact byte/depth boundaries must behave identically in browser, CLI and MCP.
- Imported sessions with plausible recomputed hashes but forged decisions must fail independent replay.
- Invalid editor drafts and changed actions must never retain a misleading current ALLOW display.
- Custom lab inputs must not broaden capabilities, alter the canonical catalog or exhaust recursive parsing.

---

### Task 1: Portable policy parsing and digest compatibility

**Files:** Create `src/policy/{types,utf8,sha256,json,schema,parse}.ts` and corresponding tests; modify MCP policy/schema wrappers.
**Interfaces:** Produces `parsePolicyJson(text: string): AuthoritySnapshot`, `sha256(text: string): string`, `utf8Length(text: string): number`, `parseBoundedJson(text: string, limits: JsonLimits): JsonValue`. Snapshot adds the validated `document` to existing metadata/versions/current fields.
- [x] Write literal SHA-256 vectors, block/Unicode parity, malformed/depth/byte JSON boundaries, policy provenance/duplicate/evidence/selector regressions and MCP digest compatibility tests.
- [x] Run focused tests; Expected: missing portable SDK fails.
- [x] Extract existing policy validation into portable modules; use pure SHA-256 and bounded JSON checks; keep Node loader and MCP exports compatible.
- [x] Run SDK and MCP tests, typecheck; Expected: all pass, existing example digest unchanged.
- [x] Verify identity and commit `feat: share portable authority policy parsing`.

### Task 2: Policy diagnostics, inspection and declared-action APIs

**Files:** Create `src/policy/{actions,service,diagnostics,history,compare,analysis,templates,search,index}.ts` and tests; change MCP action/service modules to compatible forwards.
**Interfaces:** Consumes Task 1 snapshot. Produces `checkAction(snapshot, input): ActionCheckResult`, `getAuthority(snapshot): AuthorityResult`, `diagnosePolicy(text): PolicyDiagnosis`, `inspectVersion(snapshot, number): VersionInspection`, `compareVersions(snapshot, before, after): VersionComparison`, `analyzePolicy(snapshot): PolicyAnalysis`, `explainDecision(snapshot, result): DecisionExplanation` and immutable example policies.
- [x] Write ALLOW/BLOCK/CONFIRM, stale digest, immutable snapshot, resource isolation, selector overlap, warning/provenance, protected replacement, version-delta and action-explanation tests.
- [x] Run focused tests; Expected: new APIs fail before implementation.
- [x] Move action/check semantics without altering MCP output; add read-only diagnostics/history/diff/analysis/search APIs and templates.
- [x] Run all policy and MCP tests, typecheck and lint; Expected: pass.
- [x] Verify identity and commit `feat: inspect and explain local authority policies`.

### Task 3: Reproducible advisory sessions

**Files:** Create `src/sessions/{types,schema,record,verify,query,summary,compare,redact,index}.ts` and tests.
**Interfaces:** Consumes Task 2 checks and Task 1 document/digest. Produces `createSession(policyText, id, label)`, `appendSessionCheck(session, action)`, `serializeSession(session)`, `verifySession(text): SessionVerification`, `querySession(session, query)`, `summarizeSession(session)`, `compareSessions(left,right)` and `redactSession(session)`.
- [x] Write empty/append/immutability tests, literal decision expectations, sequence/hash/tamper/replay/size regressions, bounded queries and redaction leak checks.
- [x] Run focused tests; Expected: missing session behavior fails.
- [x] Implement strict bundle format and independent decision reconstruction, then query/summary/diff/redacted-report projections.
- [x] Run policy/session suites and typecheck; Expected: pass, forged ALLOW fails verification.
- [x] Verify identity and commit `feat: record and verify advisory decision sessions`.

### Task 4: Local developer CLI

**Files:** Create `integrations/cli/{args,io,format,commands,main}.ts`, subprocess tests, CLI config/build script; modify package scripts.
**Interfaces:** Consumes Tasks 1–3 APIs. Produces `dist-cli/mandate.mjs` with policy validate/inspect/history/diff/lint/check and session create/verify/inspect/diff commands; stdout JSON or text, explicit files only.
- [x] Write actual CLI subprocess tests for help, argument errors, all decision exits, policy changes, session tampering, UTF-8/regular-file limits, stderr redaction and no action side effects.
- [x] Run tests against absent build; Expected: CLI unavailable.
- [x] Implement strict parser, bounded loader, output formatting, command dispatch and build; keep proposed actions advisory.
- [x] Run CLI/policy/session suites, builds, typecheck and lint; Expected: all pass.
- [x] Verify identity and commit `feat: add local authority developer CLI`.

### Task 5: Independent scenario and policy experiment lab

**Files:** Create `src/lab/{types,parse,run,experiments,report,compare,index}.ts`, scenario/experiment fixtures and tests; add CLI lab commands.
**Interfaces:** Consumes existing `runComparison`/`evaluateComparison` and Task 2. Produces `parseLabScenario(text)`, `runLabScenario(scenario): LabReport`, `runPolicyExperiment(experiment): ExperimentReport`, immutable extended experiments, report comparison and CLI lab list/run/validate.
- [x] Write strict/lossless scenario parsing, unknown capability, size/turn/proposal limits, reproducibility, evaluator tampering and varied authority-experiment expected outcomes.
- [x] Run focused tests; Expected: missing lab behavior fails.
- [x] Implement pure lab ingestion/reporting and substantive authority experiments; retain canonical catalog independently.
- [x] Run lab, CLI, benchmark and policy suites; Expected: canonical 5/15 vs 15/15 and checksum unchanged.
- [x] Verify identity and commit `feat: add deterministic authority scenario lab`.

### Task 6: Policy and action workbench interface

**Files:** Create `src/components/workbench/{WorkbenchView,PolicyEditor,PolicyDiagnostics,AuthorityTimeline,VersionCompare,PolicyAnalysis,ActionComposer,DecisionExplanation}.tsx`, state hook/model and styles/tests; modify App and shared navigation.
**Interfaces:** Consumes Tasks 1–3. Produces third Workbench view with explicit Apply, version inspection, compare, action simulation and session append. Invalid drafts preserve valid policy. Edited action clears prior decision.
- [x] Write rendered tests for navigation, invalid/valid Apply, all decisions, latest-version checks, stale display invalidation, clause search, version comparisons and keyboard/label behavior.
- [x] Run UI tests; Expected: Workbench absent.
- [x] Build accessible responsive components using direct imports and existing visual tokens; retain pure domain decisions.
- [x] Run UI/source tests, typecheck, lint and build; Expected: pass, Live/Benchmark unchanged.
- [x] Verify identity and commit `feat: add interactive policy authority workbench`.

### Task 7: Session and scenario workbench flows

**Files:** Create session/lab workbench components and styles; browser tests under `e2e/workbench*.spec.ts`; extend rendered tests.
**Interfaces:** Consumes Tasks 3 and 5. Produces session inspector/query/JSON verification/diff, redacted reports, custom lab editor and paired results with explicit deterministic/synthetic labels.
- [x] Write session paste/export, forged decision, filtering/pagination, redacted report, custom scenario failure/success and editor state isolation tests.
- [x] Run tests; Expected: missing flows fail.
- [x] Implement components and state transitions, labeled text outputs, detailed evidence and responsive tables.
- [x] Run UI/lab/session/CLI suites and desktop/mobile browser journeys with accessibility/offline checks; Expected: pass without console errors or host effects.
- [x] Verify identity and commit `feat: inspect sessions and sandbox scenarios in workbench`.

### Task 8: Guided policy revisions

**Files:** Create revision schema, authoring/preview/apply APIs and tests under `src/policy`; add browser authoring components and CLI revision commands.
**Interfaces:** Consumes the validated policy snapshot and digest. Produces bounded revision JSON, deterministic preview and a new validated policy document after explicit Apply; no implicit grant from text.
- [x] Write stale digest/base version, strict input, provenance, duplicate IDs, protected replacement, revocation retirement and atomic failure tests; observe failures.
- [x] Implement pure revision construction and preview, then accessible browser editing and CLI validation/application to stdout.
- [x] Run revision, policy, browser and CLI suites with typecheck/lint; verify identity and commit the feature.

### Task 9: Policy change impact and declared case suites

**Files:** Create `src/impact` modules and tests, browser comparison/case editors and CLI impact commands.
**Interfaces:** Consumes policy documents and up to 100 explicit coding action cases. Produces immutable decision-transition reports, expected-outcome qualification, historical-version comparisons and bounded queries.
- [x] Write outcome transitions, unchanged decisions under new provenance, scope isolation, invalid cases, bounds, expected-outcome mismatch and deterministic reports; observe failures.
- [x] Implement comparisons, suite import/export, report filters/summaries and browser/CLI flows.
- [x] Run impact, policy, session, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 10: Evidence trace bundles and causal inspection

**Files:** Create `src/inspection` modules/tests, trace browser components and CLI trace commands.
**Interfaces:** Consumes strict lab scenarios and existing sandbox traces. Produces independently verified paired bundles, bounded event queries, world deltas, causal links, receipt diagnostics and redacted reports; integrity does not authenticate a run.
- [x] Write forged observations/claims/worlds/receipts, resealed hashes, strict schemas, unsupported capabilities, missing evidence, deterministic queries and disclosure tests; observe failures.
- [x] Implement bundle verification and causal inspection, browser event explorer and CLI verification/inspection.
- [x] Run inspection, evidence, benchmark, lab, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 11: Reproducible adversarial campaigns

**Files:** Create `src/campaigns` modules/tests, maintained mutation cases, browser campaign view and CLI commands.
**Interfaces:** Consumes strict scenarios, trace inspection and policy experiments. Produces up to 100 explicit synthetic cases with transformation, literal invariant, result/rejection and reproducible export; canonical benchmark unchanged.
- [x] Write authority/evidence/receipt mutation expectations, input immutability, bounded campaign ingestion, deterministic reruns and false-positive/false-negative checks; observe failures.
- [x] Implement maintained mutation catalog, campaign runner, comparison/summary and browser/CLI flows.
- [x] Run campaign, lab, inspection, benchmark, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 12: Portable workspace bundles and inventories

**Files:** Create `src/workspaces` schema, manifest, verification, mutation, inventory and redaction APIs with tests; browser workspace inspector and CLI workspace commands.
**Interfaces:** Consumes validated policies, sessions, case suites, trace bundles and campaigns. Produces self-contained bounded workspaces with unique typed entries, SHA-256 manifests, independent nested verification, explicit policy staging and reproducible export. Consistency is not authentication.
- [x] Write cross-reference, manifest tampering, duplicate IDs, nested replay forgery, byte/depth/node limits, immutable add/remove/rename, inventory query and redaction tests; observe failures.
- [x] Implement workspace creation, verification and manipulation, then browser and CLI import/export/inventory flows. Stage policies only through an explicit user action.
- [x] Run workspace, policy, session, inspection, campaign, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 13: Guided deterministic scenario authoring

**Files:** Create `src/authoring` recipe schema, capability inventory, scenario construction, validation and preview APIs with tests; browser recipe authoring and CLI recipe commands.
**Interfaces:** Consumes the existing sandbox capability registry and strict lab scenario boundary. Produces scenarios from explicit source turns, intent operations, known capability arguments and literal oracle expectations; fingerprints, effect/resource metadata and version bases are derived. No permission is inferred from prose.
- [x] Write provenance, capability metadata, fingerprint, ordering, recovery, ambiguous input, bounds and all supported capability-family tests; observe failures.
- [x] Implement bounded recipe import/export and pure scenario construction, preview and browser/CLI authoring flows.
- [x] Run authoring, sandbox, lab, benchmark, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 14: Declared-policy qualification profiles

**Files:** Create `src/qualification` profile schema, criteria evaluation, independent report verification, baseline comparison and redaction APIs with tests; browser qualification view and CLI commands.
**Interfaces:** Consumes explicit policies, action case suites and literal acceptance criteria. Produces reproducible bounded qualification reports, missing-expectation diagnostics, per-case failures and profile-bound baseline comparisons. Qualification covers only declared synthetic checks and never authenticates approval or executes actions.
- [x] Write empty/partial expectations, all outcome thresholds, required-case coverage, scope errors, forged/resealed reports, baseline drift and redaction tests; observe failures.
- [x] Implement pure profile evaluation and report reconstruction, browser profile editing and CLI verification/qualification flows.
- [x] Run qualification, impact, policy, browser and CLI suites with typecheck/lint; verify identity and commit.

### Task 15: Qualification, documentation and measured delivery

**Files:** Update README, architecture/CLI/workbench guides, changelog and scripts/config as needed for valid unchanged effect budgets; add exact tracked-source counter and regression tests for unresolved issues.
**Interfaces:** Consumes all preceding tasks. Produces maintained release documentation, measured size and fresh validation evidence outside the repository.
- [x] Document runnable examples and boundaries; execute the examples through the built CLI.
- [x] Run typecheck, lint, all suites/coverage, browser/MCP/CLI builds, E2E, audit and production security gates. Expected: green; unsupported analyzer effects are investigated rather than broadly exempted.
- [x] Measure tracked TS/TSX/JS/MJS/CSS/HTML physical/nonblank lines with dependencies/generated/docs/JSON excluded. Expected: useful source approaching 40–50k; any gap is recorded and addressed through needed functionality.
- [x] Commit qualified work with verified exact identity.

After Task 15, follow the execution skill's required final stage: package the whole branch for one independent reviewer, fix Important/Critical findings in one regression-tested pass, archive ledger/evidence outside the repository, remove only this plan's scratch workspace and finish the feature branch under the user's standing authorization.

# Local MCP Authority Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local MCP client inspect operator-authored authority and check declared coding actions through Mandate's real ledger and gate.

**Architecture:** A separate Node stdio process loads one immutable policy snapshot and exposes two advisory tools. A strict action registry derives effects/resources before the existing gate evaluates them. Browser assets and authority semantics stay independent of transport code.

**Tech Stack:** TypeScript, Node.js, Zod v4, official MCP SDK v2, Vitest, esbuild.

**Spec:** [Approved design](../specs/2026-10-10-local-mcp-adapter-design.md).

**Status:** Proposed execution plan; specification approved, plan execution not yet selected.

## Global Constraints

- Tools: exactly `mandate_get_authority` and `mandate_check_action`; every successful result includes `mode: "advisory"` and `executionPerformed: false`.
- Policy: `schemaVersion: 1`; maximum 256 KiB, 100 diffs, 500 resulting clauses; initialize `createLedger([], "policy:root")` at version 1.
- Startup policy path is absolute and fixed. Read once, validate completely, freeze; changes require restart. No caller authority updates, confirmation tokens, observations, or execution.
- SHA-256 policy digest identifies the canonical validated snapshot. Engine fingerprints are correlation checksums, not security credentials.
- Supported operations: `workspace.readFile` (`READ`), `git.commit` (`LOCAL_PERSIST`), `git.push` (`EXTERNAL_TRANSMIT`), with the exact arguments/resources in the specification.
- IDs: ASCII letters/digits/underscore/hyphen, maximum 64 characters. Paths: relative POSIX, maximum 1,024 characters, NFC, no empty/dot/control/backslash segments. Refs: ordinary valid `refs/heads/` branch refs. Digests: lowercase 64-character SHA-256; object IDs: lowercase 40 or 64 hex.
- Maximum inbound frame: 64 KiB before JSON parsing; maximum validated action: 16 KiB. Diagnostics on stderr without policy/argument contents; stdout only protocol.
- Adapter sources: `integrations/mcp/`; Node ESM output: `dist-mcp/server.mjs`; browser output remains `dist/`.
- Use exact locked versions of `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and esbuild. Official SDK main currently declares 2.3.1 and Node >=20; verify registry availability before installation. Document tests on the existing Node 26.5.0 environment without claiming a lower version was tested.
- Preserve all existing browser security budgets and six-directory coverage thresholds. No API key, model call, HTTP endpoint, daemon, telemetry, or client configuration changes.
- Before every commit, apply `github-commit-identity`, verify both identities as `Abhishekpundir23 <74260202+Abhishekpundir23@users.noreply.github.com>`, and verify the resulting commit. Do not stage the local node_modules symlink.

## Review Focus

- UTF-8 policy text: enforce byte limits, not JavaScript string length; reject invalid UTF-8. Task 1.
- Prototype-like repository IDs such as `constructor`: require an actual configured ID, without inherited-property matches. Task 2.
- Concurrent checks: no caller can mutate the ledger or influence another decision. Task 2.
- Split/multiple input frames: accept valid UTF-8 and CRLF across chunks, reject an oversized line before parsing, and preserve separate valid messages. Task 3.
- Client EOF and broken stdout pipe: release handles without leaking policy text or hanging the server. Task 3.

## File Map

- `integrations/mcp/policy-schema.ts`: strict policy/diff/selector validation.
- `integrations/mcp/policy.ts`: bounded file loading, ledger construction, canonical digest, immutable snapshot.
- `integrations/mcp/actions.ts`: discriminated action schemas and trusted capability derivation.
- `integrations/mcp/service.ts`: pure authority/result projection and engine evaluation.
- `integrations/mcp/server.ts`: MCP tool registration and output envelopes.
- `integrations/mcp/bounded-input.ts`: bounded byte framing before SDK parsing.
- `integrations/mcp/cli.ts`: fixed startup arguments, process streams, shutdown.
- `integrations/mcp/*.test.ts`: colocated Node tests; `test-policy.ts` provides synthetic fixtures only.
- `scripts/build-mcp.mjs`, `tsconfig.mcp.json`, `vitest.mcp.config.ts`: separate build/typecheck/test entry points.
- `integrations/mcp/examples/draft-only-policy.json`: synthetic commit grant and transmit denial, no credentials.
- `README.md`, `docs/mcp-adapter.md`: honest use instructions and observed validation.
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore`: wire checks and exclude adapter tests/build artifacts from browser tooling.

## Task 1: Validated immutable authority snapshots

**Files:** Create policy-schema.ts, policy.ts, policy.test.ts, test-policy.ts, tsconfig.mcp.json, vitest.mcp.config.ts. Modify tsconfig.json, package.json, vite.config.ts.

**Interfaces:**

- `AuthoritySnapshot`: readonly `policyId`, `policyDigest`, `repositories`, `versions: readonly ContractVersion[]`, `current: ContractVersion`.
- `parsePolicyJson(text: string): AuthoritySnapshot`.
- `loadPolicyFile(absolutePath: string): Promise<AuthoritySnapshot>`.
- Test helper `makePolicy(overrides?): unknown` returns a schemaVersion-1 synthetic policy with one repository and ordered canonical diffs.

- [ ] **Step 1:** Add failing tests named `loads ordered authority without mutation`, `rejects partial or malformed policy`, and `enforces UTF-8 byte and ledger limits`. Assert version 1 for an empty policy, correct version increments, stable digest under object-key reordering, changed digest under policy changes, frozen nested data, and rejection of stale bases, source mismatches, duplicate turns/clauses/generated tombstones, invalid targets/confirmation/selectors, extra fields, 101 diffs, 501 clauses, 256 KiB + 1 byte, and invalid UTF-8. File tests reject a relative or missing path.
- [ ] **Step 2:** Run `npx vitest run --config vitest.mcp.config.ts integrations/mcp/policy.test.ts`; observe missing implementation failures.
- [ ] **Step 3:** Implement the three interfaces. Use strict Zod objects throughout the adapter policy boundary; the existing fixture schemas strip unknown keys, so do not use them as a substitute for strict validation. Reuse domain types, canonicalization, createLedger, and appendVersion. Validate target kinds and source consistency before appending, including generated IDs. Use bounded file reads that stop after 256 KiB + 1 byte, fatal UTF-8 decoding, Node crypto SHA-256, and frozen output. Do not change fixture schema behavior.
- [ ] **Step 4:** Add a strict Node-only tsconfig reference and independent Vitest config without React/jsdom setup. Add `test:mcp` and exclude `integrations/mcp/**` from the existing browser-oriented Vitest config to prevent duplicate/wrong-environment runs. Run the focused tests and `npm run typecheck`; expect zero failures.
- [ ] **Step 5:** Verify commit identity, stage only this task's files, and commit `feat: validate local authority policy snapshots`; verify HEAD identity.

## Task 2: Trusted action mapping and advisory decisions

**Files:** Create actions.ts, actions.test.ts, service.ts, service.test.ts. Extend test-policy.ts.

**Interfaces:**

- `CodingAction`: strict union `{ operation, args }` with operations and argument sets from the specification.
- `ActionCheckInput`: `{ expectedPolicyDigest: string; action: CodingAction }`.
- `deriveAction(snapshot: AuthoritySnapshot, action: CodingAction): ActionProposal`.
- `validateCodingCapability(snapshot: AuthoritySnapshot): CapabilityValidationPort`.
- `getAuthority(snapshot: AuthoritySnapshot): AuthorityResult`.
- `checkAction(snapshot: AuthoritySnapshot, input: unknown): ActionCheckResult`; throws typed validation/stale-snapshot errors without a decision.
- `AuthorityResult` and `ActionCheckResult` are strict schema-backed output objects containing the common advisory fields and the specification's authority/proposal/decision fields.

- [ ] **Step 1:** Write failing registry tests for each exact effect/resource and canonical args. Assert rejection of extra effect/resource/fingerprint/confirmation fields, unknown operations/IDs, invalid paths/refs/digests/OIDs, non-NFC paths, and a 16 KiB + 1-byte serialized action. A configured `constructor` repository ID works; an unconfigured one fails.
- [ ] **Step 2:** Write failing service tests for ALLOW with a grant, BLOCK without a grant, denial-over-grant, revocation after grant, CONFIRM with confirmation authority, digest mismatch, and repeated/concurrent checks returning identical immutable decisions. Assert `executionPerformed === false` and unchanged ledger/empty confirmation state on every path.
- [ ] **Step 3:** Run `npx vitest run --config vitest.mcp.config.ts integrations/mcp/actions.test.ts integrations/mcp/service.test.ts`; observe failures.
- [ ] **Step 4:** Implement the interfaces using Map/Set or explicit own-property membership. Map the public operation `git.commit` to engine tool `git` and operation `commit`, similarly for the other two. Re-derive resource/effect inside the capability port. Use the engine's fingerprintAction and evaluateAction with an empty confirmation store. Build stable action IDs from canonical correlation data, never from caller authority. Project active clauses without reading repository data or returning the policy path.
- [ ] **Step 5:** Run the focused tests, `npm run typecheck`, and `npm test -- --run src/domain src/mandate src/benchmark`; expect all pass and the existing benchmark headline/checksum unchanged.
- [ ] **Step 6:** Verify identity, commit `feat: check declared coding actions against local authority`, and verify HEAD.

## Task 3: Working stdio MCP server and bounded process boundary

**Files:** Create server.ts, bounded-input.ts, cli.ts, server.test.ts, bounded-input.test.ts, cli.test.ts, scripts/build-mcp.mjs. Modify package.json, package-lock.json, eslint.config.js, .gitignore.

**Interfaces:**

- `createMcpServer(snapshot: AuthoritySnapshot): McpServer` registers exactly the two tools.
- `createBoundedInput(input: Readable, maxFrameBytes: number): Readable` frames bytes without JSON parsing.
- `runCli(argv: readonly string[]): Promise<void>` parses only `--policy <absolutePath>`, loads once, then connects server/transport.
- Build command `npm run build:mcp` emits `dist-mcp/server.mjs`.

- [ ] **Step 1:** Verify published exact stable v2 SDK and esbuild versions/engine requirements, then install with save-exact. Server is a runtime dependency; client and esbuild are development dependencies. Replace the local node_modules symlink with a worktree-local install before adding dependencies, preserving the original checkout's install.
- [ ] **Step 2:** Write failing tests asserting two deterministic tool definitions with strict schemas and read-only/idempotent annotations; structured/text results agree; BLOCK/CONFIRM are ordinary results; malformed inputs return tool errors without a decision.
- [ ] **Step 3:** Write failing stream tests for a split UTF-8 character, split CRLF, two valid lines in one chunk, exactly 64 KiB payload (excluding LF), and 64 KiB + 1 byte with/without LF. The oversized case must fail before any JSON parser receives the frame; no unbounded accumulation.
- [ ] **Step 4:** Run the server and stream tests through `vitest.mcp.config.ts`; observe failures.
- [ ] **Step 5:** Implement registration using the SDK's McpServer and StdioServerTransport. Supply bounded input to the transport and a 64 KiB SDK maxBufferSize defense. Emit one complete accepted frame at a time, retaining raw UTF-8 bytes. Register fixed tool descriptions explaining advisory behavior. Use SDK lifecycle/metadata support instead of hand-written protocol messages.
- [ ] **Step 6:** Implement strict startup arguments and startup-before-connect validation. Keep stdout protocol-only; log fixed diagnostic categories to stderr without raw exceptions/paths/policy/arguments. Close on EOF/termination; handle EPIPE without an uncaught exception or open handle. Build with esbuild platform=node, format=esm, packages=external, bundle=true, and the dedicated CLI entry.
- [ ] **Step 7:** Add subprocess tests for missing/invalid policy and flags, EOF before/after connection, termination, and broken output pipe. Assert bounded exit times, nonzero invalid-startup exit, and no policy/argument leakage. Run `npm run build:mcp`, all MCP tests, typecheck, and lint; expect pass.
- [ ] **Step 8:** Ignore/exclude dist-mcp from Git, ESLint, and test discovery. Verify identity, commit `feat: expose advisory authority tools over local MCP`, and verify HEAD.

## Task 4: Real client interoperability and regression qualification

**Files:** Create client-integration.test.ts, integrations/mcp/examples/draft-only-policy.json, docs/mcp-adapter.md. Modify README.md, package.json, docs/improvement-changelog.md.

**Interfaces:** The official client starts `node dist-mcp/server.mjs --policy <absolute-path>` and exercises tools/list and tools/call through the SDK.

- [ ] **Step 1:** Write failing subprocess integration tests that connect/list/call/close using the official client. The synthetic policy permits commit and denies external transmit: assert ALLOW commit, BLOCK push with the denial ID, CONFIRM under a separate confirmation policy, structured output schemas, and false executionPerformed on every result. Use only temporary policy files and no actual Git commands.
- [ ] **Step 2:** Add a restart test: read digest A, modify policy and restart, then assert old digest A errors and fresh digest B obtains the changed decision. Add raw-stream capture coverage proving stdout contains protocol lines only and stderr omits a recognizable synthetic policy marker.
- [ ] **Step 3:** Run `npm run build:mcp && npm run test:mcp`; investigate any round-trip failure at the actual transport boundary, then rerun only after a fix. Expect all MCP tests pass and child processes exit.
- [ ] **Step 4:** Add the verified example and documentation: exact startup command, observed Node/SDK versions, policy authoring/restart instructions, the three supported declared primitives, read-only policy disclosure, and advisory limitations including Git hooks and the lack of observed execution evidence. Do not modify or claim a named coding-agent configuration.
- [ ] **Step 5:** Wire `build:mcp` and `test:mcp` into the complete verify sequence once, retaining all existing gates. Run typecheck, lint, source/MCP tests, required source coverage, production build, E2E, and security analyzer. Reuse an unchanged completed 508-case analyzer run rather than rerun it solely for documentation; rerun it if analyzer/shared behavior changes.
- [ ] **Step 6:** Check browser module receipts and built assets contain no integrations/mcp or MCP SDK imports. The existing security gate and offline browser tour must pass with zero forbidden/unknown production effects.
- [ ] **Step 7:** Record exact commands, counts, versions, and observed client results in the changelog. Verify identity, commit `test: qualify local MCP authority interoperability`, and verify HEAD.

## Review and execution handoff

Review this plan before implementation. Native execution is recommended because all four tasks share the policy/action interfaces, and this version cannot execute real actions. Native means the primary worker implements the tasks in this session, followed by a fresh whole-branch reviewer through the execution skill. Subagent-driven execution uses a fresh implementer/reviewer for each task and costs more context.

No MCP product code or dependencies have been added while writing this plan. A real client round trip, rather than a mock transport or configuration file alone, is the completion criterion.

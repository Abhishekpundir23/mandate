# Local MCP authority adapter

Date: 2026-10-10
Status: approved and implemented in this session. See the [adapter guide](../../mcp-adapter.md) for current commands and observed validation.

## Purpose and success

Mandate currently demonstrates authority gating over deterministic fixtures. The first coding-agent integration will expose the existing pure ledger and gate to a local MCP client. An engineer can inspect an operator-authored contract and ask whether a specific proposed coding action matches that contract.

The user requested improvements to the demo, engine, and coding-agent integration, and selected a local MCP adapter as the first integration design. This version is advisory: it computes a decision and performs no proposed action. An agent with other tools can ignore the result. Successful delivery means an actual MCP client can list and call the adapter's tools over stdio and obtain tested decisions from the real Mandate engine. It does not mean that an agent's other tools have been secured.

## Selected approach

Use a separate Node.js process with the official TypeScript MCP SDK and stdio transport. Reuse Mandate's pure canonicalization, ledger, and gate modules. Keep the React application and its closed-world production graph independent of the adapter.

A JSON command-line interface would have fewer dependencies but require custom client integration. A real execution broker could enforce decisions, but would also need trustworthy target resolution, execution, confirmation provenance, and observations. Those are a separate subsystem. MCP provides a useful first integration without making an enforcement claim.

## Trust and authority

The human operator supplies one absolute policy-file path at process startup. The process reads that file once, validates it, builds a frozen ledger, and then accepts MCP requests. It never accepts policy paths, authority diffs, confirmation tokens, observations, or permission overrides from tool callers.

The local operator and the policy file are trusted inputs. MCP request arguments and client identity fields are untrusted. The policy's source quotes are provenance data, not executable instructions. A client name, prompt, claimed approval, or a successful earlier decision cannot create authority.

Policy changes require restarting the process. Every result identifies the loaded policy snapshot; it does not assert that the snapshot still represents the user's latest conversation. The operator must update the policy and restart after a change in intent. Live conversational updates and revocation propagation are outside this version.

The server's OS account can access the policy file. This design does not establish protection against another process with the same filesystem permissions modifying that file or launching a different server.

## Policy format and loading

Use strict JSON with these top-level fields:

- `schemaVersion: 1`.
- `policyId`: a human-readable identifier.
- `repositories`: unique logical repository IDs and their allowed remote IDs.
- `diffs`: an ordered array of canonical `IntentDiff` records.

Initialize with `createLedger([], "policy:root")`, whose empty contract is version 1. Apply each validated diff with `appendVersion`. The first diff therefore has `baseVersion: 1`. Source turn IDs must be unique and consistent with their source references. Clause IDs must be unique across the ledger, including generated replacement tombstones; reject duplicates before accepting the policy. Reject invalid clause kinds, selectors, confirmation shapes, unknown replacement/revocation targets, stale versions, and unknown fields. Check semantic invariants in addition to parsing JSON. An empty authority ledger is valid and grants nothing.

Evidence references are checked against the resulting atomic version, allowing a rule to reference a grant introduced in the same diff. Replacement and revocation targets are checked against the preceding version.

Only selectors for the three supported capabilities below, their effects, and their canonical resources are accepted. Selectors may omit fields to express broader authority deliberately, including an effect-wide denial. Unsupported or malformed selectors fail startup instead of silently becoming ineffective.

Reuse or extract the existing domain schemas where they express the same contract. Do not weaken fixture validation to accommodate this adapter. The natural-language compiler is not used: this version does not turn arbitrary conversation text into permission.

Maximum policy size is 256 KiB, with at most 100 diffs and 500 resulting clauses. Validate before allocating an unbounded ledger. Missing, oversized, or invalid policy files cause a nonzero exit and a concise stderr diagnostic. The process must not become available with a partial policy.

Compute `policyDigest` as SHA-256 of the validated canonical policy JSON. Include it in every tool result. This identifies a policy snapshot; it is not a signature or proof of who approved it. Existing engine hashes and action fingerprints remain deterministic correlation checksums, not authentication credentials.

## Proposed tools

Expose exactly two tools with strict input/output schemas and deterministic ordering in `tools/list`. Both are read-only and idempotent with respect to server state.

### `mandate_get_authority`

Input: an empty object; additional properties are rejected.

Output includes `mode: "advisory"`, `executionPerformed: false`, policy ID and digest, current contract version and engine hash, the supported operation catalog, and active clauses including retained revocation boundaries. Each clause includes its ID, kind, selector, statement, source reference, and confirmation requirement where applicable.

This exposes the policy's own text to the calling client. Documentation must tell the operator to omit credentials and secrets from policy statements and source quotes. It never reads repository contents or reveals the policy's filesystem path.

### `mandate_check_action`

Input is `{ expectedPolicyDigest, action }`. The caller must first obtain the digest through `mandate_get_authority`. A mismatched digest produces an error with no authorization decision.

`action` is a discriminated union of the supported operations and their arguments. It does not contain an effect, resource, fingerprint, authority version, confirmation, or caller-provided decision. Reject extra fields.

| Operation | Required arguments | Derived effect | Derived resource |
| --- | --- | --- | --- |
| `workspace.readFile` | `repositoryId`, `path` | `READ` | `repository:<id>/file:<path>` |
| `git.commit` | `repositoryId`, `treeDigest`, `messageDigest` | `LOCAL_PERSIST` | `repository:<id>` |
| `git.push` | `repositoryId`, `remoteId`, `ref`, `commitOid` | `EXTERNAL_TRANSMIT` | `repository:<id>/remote:<remote>/ref:<ref>` |

The repository and remote IDs must exist in the operator's policy. IDs use ASCII letters, digits, underscore, and hyphen, with a 64-character limit. File paths are relative POSIX paths of at most 1,024 characters: reject absolute paths, backslashes, empty segments, dot segments, control characters, and non-NFC strings. Resources retain case exactly. Ref names are restricted to ordinary branch refs under `refs/heads/`; reject Git-invalid characters and components, repeated slashes, dot components, `..`, `@{`, trailing dots, and `.lock` components. Repository/ref spelling is never normalized into a different target.

Tree and message digests are lowercase 64-character SHA-256 hex strings; Git object IDs are lowercase 40- or 64-character hex strings. They describe proposed data only. The server does not inspect a Git tree, validate an object exists, resolve a symlink, read a file, or verify that a remote ID corresponds to a real endpoint. It must not label these declarations as observed evidence.

A trusted registry derives the single effect and exact resource and constructs the existing `ActionProposal` with normalized arguments and a server-computed fingerprint. The `CapabilityValidationPort` independently checks the same operation schema and derives its effect/resource before `evaluateAction` runs. No generic shell command, composite action, file write, deployment, or capability registration is supported in this version.

These operation names describe declared primitives, not a validation of a shell command. For example, the commit model covers persisting the declared tree and message; it cannot authorize hooks that send data or publish artifacts. The adapter cannot prove that a caller will execute only the declared primitive. Actual Git commands, hooks, symlinks, and remote resolution require the later broker's independently verified execution boundary.

Always pass an empty confirmation store and no confirmation token. Matching confirmation authority returns `CONFIRM`; the agent cannot satisfy it through another tool call. Active denials and revocations retain the engine's precedence. Missing grants remain `BLOCK`.

Output includes the policy identifiers, `mode: "advisory"`, `executionPerformed: false`, the canonical proposal, and the engine's `GateDecision`: outcome, contract version, action fingerprint, matched clause IDs, and reasons. Ordinary `BLOCK` and `CONFIRM` decisions are successful tool results. Schema failures, unsupported operations, and digest mismatches are tool errors without an `ALLOW`/ `BLOCK`/ `CONFIRM` decision.

An `ALLOW` concerns only the declared action under this snapshot. It is not a transferable token, human confirmation, execution receipt, completion claim, or permission for a different action.

## Example use

The operator's policy grants `git.commit` on `repository:mandate` and denies `EXTERNAL_TRANSMIT`. The client reads authority, then checks a proposed commit with its tree/message digests: the engine returns `ALLOW`. Checking a push to the configured `origin` branch returns `BLOCK` with the denial's clause ID. A separate policy requiring confirmation for that push returns `CONFIRM`.

All three results say `executionPerformed: false`. Nothing is committed, pushed, or confirmed by these calls. Changes to the tree, message, branch, remote, or policy require a fresh check.

## Runtime and build boundary

Put adapter source under `integrations/mcp/` with a dedicated entry point, schemas, policy loader, capability registry, and tests. Use a separate Node build output under `dist-mcp/`; the existing browser build remains under `dist/`. Neither browser source nor its production entry may import adapter modules or SDK packages.

Use the stable v2 `@modelcontextprotocol/server` package at runtime and `@modelcontextprotocol/client` for integration tests. Pin exact package versions and the lockfile during implementation. Reuse existing Zod v4 for schemas. Build the adapter as a Node ESM bundle with shared pure engine modules included and vendor dependencies external; add a dedicated esbuild development dependency for this build. Document the supported Node version after checking the SDK's engine requirement.

The proposed invocation is `node dist-mcp/server.mjs --policy /absolute/path/policy.json`. No daemon, listening socket, HTTP route, authentication service, model call, telemetry, or credential storage is introduced. The fixed policy read is the only adapter filesystem read at startup, apart from Node loading program modules. Tool calls perform pure computation. Diagnostics go to stderr, with no policy contents or action arguments logged by default; stdout contains MCP protocol messages only.

Use the SDK for transport framing, protocol metadata, lifecycle, and compatibility handling. Do not hand-code a legacy initialize handshake or promise compatibility with an untested client. Enforce a 64 KiB inbound message limit before JSON parsing through a bounded stdio reader integrated with the SDK transport, plus a 16 KiB validated action limit. Oversized frames terminate the process with a bounded diagnostic. Test this transport boundary directly.

Return structured tool content and a concise text rendering of the same result. Do not duplicate sensitive values in logs. Unsupported protocol versions follow SDK negotiation/error behavior. End-of-input and termination release the process cleanly.

## Acceptance tests

1. Launch the built server as a subprocess through the official MCP client. Exercise the supported connection lifecycle, list both tools, call each, validate structured output, and close the process.
2. Assert real engine decisions for grants, missing grants, active denials, denial/grant conflicts, revocation, and confirmation requirements. Include a later diff revoking an earlier grant.
3. Reject unknown operations, forged effect/resource/confirmation fields, unknown repository/remote IDs, malformed paths/refs/digests, and a stale policy digest. No invalid input may return `ALLOW`.
4. Reject malformed policy shapes, duplicate IDs, invalid authority targets, stale versions, and size/count violations at startup. Verify no partially loaded server is callable.
5. Verify repeated checks cannot mutate the ledger, mint tokens, consume confirmation, or change later decisions. Restart with a changed policy and require the new digest.
6. Capture subprocess stdout/stderr: every stdout line is protocol data; diagnostics omit policy text and arguments. Exercise oversized input and clean EOF.
7. Run the existing benchmark, unit, coverage, build, browser, and production security gates. Browser effects remain within existing budgets, with no adapter or SDK in browser assets.
8. Record the exact SDK/client versions, process command, and observed round-trip result. A client fixture is sufficient to prove MCP interoperability for this version. Claim a connection to a named coding agent only after a separately authorized and observed test in that agent.

## Later enforcement work

A future broker must own actual tools and independently resolve their targets, re-check current authority immediately before execution, obtain confirmation through a trusted human channel, and collect real observations. It must bind approval to cryptographically strong canonical action data and handle changes between checking and executing. That work needs its own design; neither the current 32-bit correlation fingerprint nor this advisory server is a security credential.

## Protocol sources checked on 2026-10-10

- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): stable v2 server/client packages and SDK documentation.
- [MCP stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio): local subprocess framing and stream separation.
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): discovery, calls, schemas, and tool results.

The selected current protocol revision is 2026-07-28. Compatibility with earlier clients is a tested SDK concern, not an assumption that all MCP clients share one lifecycle.

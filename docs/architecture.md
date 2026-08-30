# Architecture and trust boundaries

MANDATE separates what the user authorized from what an assistant proposed, and separates both from what the sandbox actually observed.

```mermaid
flowchart LR
  T[Ordered user turns] --> C[Canonical intent diffs]
  C --> L[Append-only contract versions]
  P[Shared proposal program] --> S[Standard bypass lane]
  P --> G[Mandate action gate]
  L --> G
  S --> X[Deterministic capability sandbox]
  G -->|ALLOW only| X
  G -->|BLOCK / CONFIRM| R[Recovery program]
  R --> G
  X --> O[Tool observations + immutable world]
  O --> E[Evidence and completion receipt]
  O --> B[Independent benchmark evaluator]
  L --> E
  L --> B
```

## Causal chain

1. Each ordered turn carries a validated canonical diff. The compiler normalizes it; the ledger appends a new contract version without mutating prior versions.
2. The Standard and Mandate runners consume the identical frozen proposal program. Standard validates shape but bypasses authority. Mandate fingerprints each proposed action and evaluates it against the current version's active clauses.
3. Only an `ALLOW` decision reaches a registered deterministic capability. `BLOCK` prevents execution. `CONFIRM` cannot become permission without a matching, single-use confirmation bound to the action fingerprint and authority version.
4. A capability returns a new immutable world plus an observation with logical identity and evidence facts. Completion claims are verified only against earlier successful observations and current world predicates.
5. Receipts rebuild fixture authority, reconcile emitted versions, report blocked or unauthorized actions, and distinguish exact completion from an incomplete or unsafe run.
6. The benchmark independently reconstructs valid executions from trace events, the fixture, and sandbox semantics before it aggregates results.

## Trust boundaries

| Boundary | Trusted input | Untrusted input | Enforcement |
| --- | --- | --- | --- |
| Fixture ingestion | Canonical 15-case manifest | Any supplied JSON-like fixture | Strict schema, dense-data checks, reference/order checks, immutable normalization |
| Authority | Validated ordered diff | Proposal claims about permission | Append-only versions, active-clause resolution, tombstones, fail-closed malformed input |
| Execution | Registered local capability | Action metadata, payload, effect, resource | Exact capability validation, normalized fingerprint, gate decision before execution |
| Evidence | Reconstructed successful observation | Event labels and completion prose | Logical identity, metadata/world replay, predicate support before claim time |
| Benchmark | Fixture oracle and independently replayed facts | UI snapshot or claimed score | Pair parity, checksums, trace lifecycle and terminal-world checks |
| Browser/runtime | Built local assets | Any cross-origin request or real action | Route-abort E2E plus source and production-bundle deny/allowlist gate |

The React layer is a projection of frozen snapshots. It does not decide permission or manufacture metrics. The source gate builds one TypeScript `Program`, lowers declarations, parameter bindings, object/array patterns, assignment/update/delete targets, loop targets, calls, constructors, and tagged templates into a uniform binding/write/call IR, then solves a monotone origin-and-effect graph across all production modules. Constant, fresh owned allocation, borrowed data, ambient authority, opaque capability, summarized callable, React UI cell, and unknown origins survive casts, aliases, generics, containers, closures, returns, arguments, loops, and reassignment. A write or mutator is accepted only when its receiver remains a proven fresh local allocation or the write targets an explicit React UI cell. Computed writes to ordinary prototype-bearing objects also require a finite safe key; only an owned null-prototype dictionary may accept an unknown string key.

Every call, optional call, constructor, tagged template, higher-order callback, standard mutator, `Object`/`Reflect` mutation API, React hook, and Zod chain must resolve to an analyzed local function or a declarative summary. Unsupported resolution emits `HOST_UNKNOWN` and fails. Mutation APIs are checked by receiver origin rather than property spelling, so a harmless local `innerHTML` data field is allowed while the same spelling on DOM-derived or unknown state is denied. There are no file, function, or source-location reflection exceptions. Each module is checked against an exact effect budget and the deterministic report separately accounts for local mutation, UI state, timers, viewport reads, DOM mount, focus, scroll, network, storage, navigation, form submission, unsafe DOM writes, dynamic code, and unknown effects.

Raw browser access is concentrated in `src/platform/browser-capabilities.tsx`. That facade exposes only hard-coded `#root` mounting, three approved media queries without returning `MediaQueryList`, a fixed replay timer, and opaque accessible focus/compact-scroll operations. Other production modules have no ambient budget. Network, storage, navigation, form submission, unsafe DOM mutation, dynamic code, and unknown effects are forbidden everywhere. This is a closed-world proof for the production subset recognized by the analyzer, with unsupported effects deliberately failing closed; it is not a proof over arbitrary JavaScript. The independent layers remain in place: the production build disables Vite's module-preload polyfill and asset inlining, the built policy admits zero network primitives, strict CSP permits local assets only, and browser instrumentation/request interception exercises the complete product tour on desktop and mobile.

`npm run test:security` is the public standalone gate and always runs a fresh production build before scanning. `npm run test:security:built` scans an already-built tree and is used only after an explicit build in the non-recursive `verify` pipeline. A behavioral test seeds a stale forbidden asset and proves that the standalone command replaces it through the build rather than scanning or accepting stale output.

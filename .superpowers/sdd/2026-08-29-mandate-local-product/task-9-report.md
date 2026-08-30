# Task 9 closed-world capability/effect report

Date: 2026-08-30

Plan/base commit: `7eefaee` (source-equivalent architecture base `ae43163`)

Initial Task 9 implementation: `4d030474f3d90329270fed24e398964e4bf31cf6`

Review base: `cace6cd359b8368ffc01ab623e013e2d1602ebdd`

Review-fix implementation: `e51e377d958b2fa0455237a73f5885afe3b1ba6e`

Branch: `feat/mandate-local-product`

Scope remained local. No deploy, push, publish, upload, registration, submission, or external-system operation occurred.

## Outcome

Task 9 now enforces one closed-world production analysis:

```text
index.html entry
  -> reachable local runtime graph
  -> TypeScript Program + uniform binding/write/call IR
  -> conservative origin/effect fixed point
  -> exact module effect budgets
  -> source/runtime/bundle receipts + exact Rollup chunk receipts
```

The source analyzer checks all 52 current production TS/TSX modules (the 51 modules inherited from Task 8 plus the browser facade), and the entry graph proves 49 are runtime-reachable from the HTML entry. The build independently reports the same 49 runtime source modules and exactly three JavaScript chunks. A runtime-reachable test file or unsupported source extension is rejected rather than excluded.

The final effect report contains zero network, storage, navigation, form-submit, unsafe-DOM, dynamic-code, and unknown effects. There are no file, function, line, or source-location exceptions.

## Review RED/GREEN evidence

The review fixes were developed from reproductions on `cace6cd` before mechanism changes.

| Corpus or public boundary | RED on review base | GREEN on `e51e377` |
| --- | --- | --- |
| Independent 67-program strict-valid matrix | 23 hostile programs accepted; 10 safe programs rejected | All 47 hostile programs rejected; all 20 safe programs accepted; 0 mismatches |
| HTML/runtime inventory public-command probes | Declarative-shadow-DOM HTML and one copied/unreceipted JS asset both passed; each build still claimed 162 modules and 52/49/49 receipts | Both fail the public security command; HTML `template` is forbidden and exact chunk receipts reject extra JS |
| Receiver-contract widening | 5/5 broadened `Reflect`, `Object.assign`, `client.fetch`, `window.focus`, and `document.getElementById` signatures passed | All five reject; exact scalar/direct contracts still pass |
| Callable-object hidden host fields | 3/3 capability-bearing callable objects passed | All three reject; callable receiver brands include non-call fields and signatures |
| Expanded structural suite | Review/audit probes exposed ambient projection, reflection, container, JSX/ref, prototype, escape, totality, receipt, and facade roots | 324/324 pass |

The original independent matrix is frozen: 47 hostile and 20 safe programs. Its hostile side includes the 23 accepted review false-greens for ambient/emitless contracts, reflection/meta-calls, loop/container laundering, React-ref transfer, prototype keys, and mutate-after-escape. Its safe side includes the 10 rejected review controls for finite keys, local contracts, nested/rest owned data, bound local functions, local class writes, and owned callback results.

Later source audits added paired cases for exact versus widened receiver contracts; lexical and JSX callback/event/timer transfers; generic/default/undefined arguments; hard-private members; same-allocation aliases; declarative shadow DOM; unreceipted JavaScript; and transitive callable-object fields. The last pre-final run was 319/320 because a safe nested scalar callback was double-counted as aggregate content; the path-local transitive callable-accounting fix and its hostile dual-path guard produced the final 324/324 result.

## Implemented mechanisms

### Closed inventory and receipts

- `security-source-inventory.mjs` starts from scripts in `index.html`, resolves every reachable local runtime import, and records a deterministic source graph.
- Test-scoped paths are excluded only when they are proven unreachable. A reachable `.test.ts`, `src/test` module, JS/JSX module, or other unsupported runtime extension fails closed.
- Every reachable TS/TSX source requires an analysis receipt. Vite receipt schema v3 records the exact Rollup source-module graph and exact emitted JS chunks; the built scanner requires set equality, not a count or subset match.
- Fresh-build enforcement, source analysis, built-asset inspection, CSP, and browser runtime interception remain independent layers.

### Origin, call, and value-transfer analysis

- All declaration, parameter, catch, object/array binding, destructuring-assignment, member-target, loop, direct/compound/update/delete, Object/Reflect, descriptor, collection-mutator, and React-ref channels lower into one write/binding/call model.
- Ambient and opaque origins survive every property/element projection. Emitless declarations typed as host interfaces are ambient. Casts, generics, aliases, closures, returns, arguments, loops, conditionals, containers, spreads, callbacks, and reassignment cannot erase provenance.
- Function summaries join observed arguments with declared external origins instead of replacing them after a safe warm-up call. Unknown callees, callbacks, constructors, tags, JSX/ref edges, and unsupported strict-TypeScript semantics emit deterministic `HOST_UNKNOWN` diagnostics.
- `call`, `apply`, and `bind` require a non-empty directly analyzed callable set. Reflection results retain opaque provenance, and borrowed/opaque constructors are forbidden.

### Unified mutation and prototype policy

- Direct writes, destructuring targets, `Object.assign`, descriptor APIs, `Reflect.*`, and collection mutators use one receiver/key validator.
- Mutation is permitted only for proven fresh, unescaped local allocations or explicit UI cells. Passing owned state across an unresolved boundary marks it escaped.
- Prototype-bearing targets require finite safe keys and reject `__proto__`. Null-prototype certainty is all-path/AND, and Object.assign sources require resolved getter-free safe keys.
- Safe nested/rest projections, finite literal-union and conditional keys, local constructors/classes, exact scalar reflection, and owned map callback results remain accepted.

### Browser facade and exact contracts

- Raw `window`/`document` production references are confined to `src/platform/browser-capabilities.tsx`.
- Every facade export is inspected through aliases, nested return types, closures, defaults, and class/callable shapes. Raw DOM roots, media-query objects, React roots, and capability leaves cannot escape.
- Receiver contracts are exact and direct. Approved local controls include `client.fetch(): string`, `window.focus(): void`, `document.getElementById(string): string`, exact scalar `Reflect.get/set`, and exact generic `Object.assign<T extends object>(T, Partial<T>): T`. Aliases, overloads, extra call/construct/index/member authority, and wider signatures do not inherit those summaries.
- The facade exposes only hard-coded root mounting, approved media-query values/subscriptions, a fixed replay timer, and opaque focus/compact-scroll hooks. Product behavior is unchanged.

## Deterministic host-effect report

Exact final totals over 52 analyzed production modules:

| Effect | Count |
| --- | ---: |
| `HOST_LOCAL_MUTATION` | 57 |
| `HOST_UI_STATE` | 26 |
| `HOST_TIMER` | 2 |
| `HOST_VIEWPORT_READ` | 6 |
| `HOST_DOM_MOUNT` | 3 |
| `HOST_DOM_FOCUS` | 0 |
| `HOST_DOM_SCROLL` | 0 |
| `HOST_NETWORK` | 0 |
| `HOST_STORAGE` | 0 |
| `HOST_NAVIGATION` | 0 |
| `HOST_FORM_SUBMIT` | 0 |
| `HOST_UNSAFE_DOM_WRITE` | 0 |
| `HOST_DYNAMIC_CODE` | 0 |
| `HOST_UNKNOWN` | 0 |

`forbidden=0; unknown=0`.

Receipt totals are 52 analysis receipts, 49 runtime-entry receipts, and 49 bundle-source receipts. Receipt schema v3 records exactly these built chunks:

- `assets/index-feGJMcbv.js`
- `assets/vendor-react-Bfx28lbG.js`
- `assets/vendor-zod-CwsIYWen.js`

The final standalone production gate completed in 8.77 seconds with maximum RSS 933,347,328 bytes and peak footprint 950,872,544 bytes.

## Fresh full verification

Fresh command on the review-fix implementation:

```text
npm run verify
```

| Stage | Result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit/security/component | 28 files, 620 passed, 0 failed |
| Coverage run | 28 files, 620 passed, 0 failed |
| Global coverage | Statements 96.12% (1537/1599); branches 91.58% (1285/1403); functions 98.65% (439/445); lines 97.30% (1408/1447) |
| Build | Vite 8.2.2; 162 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 18 scheduled across desktop/mobile; 13 passed; 5 intentional project-specific skips; 0 failed |
| Source/effects | 52 analyzed; 49 runtime receipts; forbidden 0; unknown 0 |
| Built security | 49 bundle receipts; exact three JS chunks; strict local CSP/assets; zero built network primitives |

The host emitted its existing Playwright `NO_COLOR`/`FORCE_COLOR` warning. The application tour independently asserted zero product console warnings/errors, page errors, unexpected external requests, or runtime capability violations.

The public absent-`dist` proof used a disposable full project: `npm run typecheck` passed, `dist` was confirmed absent, and `npm run test:security` rebuilt 162 modules before the same source/effect/bundle gate passed. The automated stale-`dist` replacement test also remains green.

## Hard six-directory coverage

No source exclusion or threshold change was made. Every required metric is at least 90%:

| Directory | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/domain` | 100.00% | 98.92% | 100.00% | 100.00% |
| `src/mandate` | 97.31% | 92.44% | 100.00% | 97.46% |
| `src/runtime` | 98.20% | 93.61% | 100.00% | 98.14% |
| `src/sandbox` | 96.29% | 92.15% | 96.15% | 97.46% |
| `src/evidence` | 98.18% | 94.35% | 100.00% | 98.11% |
| `src/benchmark` | 95.15% | 91.32% | 98.44% | 97.15% |

## E2E, geometry, and visual invariance

- Playwright: 13 passed, 5 intentional cross-project/single-writer skips, 0 failed.
- Desktop Live: 1586×992; SHA-256 `9ec1085c6dea4e9f4e937022618b9df6db570dbaddd2c6ec7d97a0c98fe50087`.
- Mobile Live: 853×1844; SHA-256 `dc5b4d941bf60e3c137cf526013a04da2acd3e4b853dd768f913e488e501c132`.
- Desktop Benchmark: 1586×992; SHA-256 `c1eef2d3384795604d6866c4a382203896f35384b55640a4b8ec8e0b91d99078`.

All three hashes exactly match the approved Task 8 screenshots. Desktop benchmark geometry still has all 15 rows fully visible, `scrollTop=0`, and zero horizontal overflow. The mobile proof asserts zero horizontal overflow, footer alignment at the viewport bottom, and the complete keyboard path.

## Post-GREEN source-level audit

The final independent-style audit rechecked receiver/callable fields, ambient projections, reflection/meta-calls, JSX chains, lexical callbacks, event/timer extra arguments, hard-private members, same-allocation aliases, generic defaults, prototype certainty, declarative shadow DOM, chunk receipts, and paired safe controls. It found no residual root-complete false-green. Final hygiene also confirms:

- raw ambient production access is confined to the facade;
- no `safeReflectionSites` or file/function/line exception remains;
- effect and provenance diagnostics are deterministic and sorted;
- `git diff --check` passes;
- implementation and documentation are separate commits.

## Bounded guarantee, TCB, and residual risk

The guarantee is closed-world over the current HTML-reachable runtime graph and the strict TS/TSX subset implemented by the analyzer. All current non-test production TS/TSX files are analyzed, and every graph-reachable module must have a receipt. A reachable unsupported extension, syntax, import, callable, mutation origin, or host effect fails closed.

The trusted computing base is the TypeScript compiler/checker, the inventory/normalizer/origin/effect analyzer and explicit summaries/budgets, Node path/filesystem canonicalization, the HTML/source-graph parser, and Vite/Rollup's module and output graph used for receipts. Third-party vendor implementation semantics and arbitrary JavaScript are not source-proven; their emitted chunks are nevertheless receipt-bound and independently checked by the built-asset policy. Browser correctness is not statically proven.

Residual risk is bounded by independent strict CSP, fresh-build enforcement, exact asset/chunk inventory, built-network/unsafe-primitive scanning, and desktop/mobile runtime interception. This is deliberately not a claim to prove arbitrary programs or third-party internals.

No external action was performed and no challenge submission was made.

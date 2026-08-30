# Task 9 closed-world capability/effect report

Date: 2026-08-31

Plan/base commit: `7eefaee` (source-equivalent architecture base `ae43163`)

Initial Task 9 implementation: `4d030474f3d90329270fed24e398964e4bf31cf6`

Review base: `cace6cd359b8368ffc01ab623e013e2d1602ebdd`

Review-fix round 1: `e51e377d958b2fa0455237a73f5885afe3b1ba6e`

Review-fix round 2 base: `6e9c18a172f42ea50191f98ace0291a5f5ec3a42`

Review-fix round 2 implementation: `670e5de8087a13446eca8c77bad32fe0be540bd8`

Branch: `feat/mandate-local-product`

Scope remained local. No deploy, push, publish, upload, registration, submission, or external-system operation occurred.

## Outcome

Task 9 enforces one closed-world production analysis:

```text
index.html entry
  -> reachable local runtime graph
  -> TypeScript Program + uniform binding/write/call IR
  -> conservative origin/effect fixed point
  -> exact module effect budgets
  -> source/runtime/bundle receipts + exact Rollup chunk receipts
```

The source analyzer checks all 52 current production TS/TSX modules (the 51 modules inherited from Task 8 plus the browser facade), and the entry graph proves 49 are runtime-reachable from the HTML entry. The build independently reports the same 49 runtime source modules and exactly three JavaScript chunks. A runtime-reachable test file or unsupported source extension is rejected rather than excluded.

Round 2 closes two critical semantic gaps and three safe-control gaps: `Reflect.set` now validates its ECMAScript effective receiver and pre-dispatch state; deferred callbacks retain semantic callable/argument/`this` records and are replayed when captured state widens; fresh `Map.get`, `Set` iteration, and hard-private instance mutation remain accepted. The same mechanisms cover every unified `[[Set]]` channel, complete versus partial key domains, descriptor must-state, absence, cross-module facade exports, JSX callback shapes, timers/listeners, React effects and cleanups, and nested callback wrappers.

The final effect report contains zero network, storage, navigation, form-submit, unsafe-DOM, dynamic-code, and unknown effects. There is no file/function/line/test-name source-location allowlisting escape hatch; the explicit browser-facade and exact per-module effect budgets remain intentional policy boundaries.

## RED/GREEN evidence

### Review-fix round 1

The first review fixes were developed from reproductions on `cace6cd` before mechanism changes.

| Corpus or public boundary | RED on review base | GREEN after round 1 |
| --- | --- | --- |
| Independent 67-program strict-valid matrix | 23 hostile programs accepted; 10 safe programs rejected | All 47 hostile rejected; all 20 safe accepted; 0 mismatches |
| HTML/runtime inventory probes | Declarative-shadow-DOM HTML and copied/unreceipted JS passed | Both fail the public security command |
| Receiver-contract widening | 5/5 widened signatures passed | All five reject; exact scalar/direct contracts pass |
| Callable-object host fields | 3/3 capability-bearing callable objects passed | All three reject |
| Expanded structural suite | Ambient projection, reflection, container, JSX/ref, prototype, escape, totality, receipt, and facade roots exposed | 324/324 passed |

### Review-fix round 2

The exact public reproductions and safe controls were first run against `6e9c18a`.

| Boundary | RED on `6e9c18a` | GREEN on `670e5de` |
| --- | --- | --- |
| `Reflect.set({}, 'marker', value, receiver)` | Public gate accepted a runtime write through an unproven fourth receiver | Effective receiver is modeled; unsafe target/receiver/dispatch combinations reject |
| Deferred callback with a later-widened capture | Public gate reported zero effects although a later timer execution leaked a DOM-derived value | Registration retains callable, args, bound `this`, capture dependencies, and deferred replay |
| Safe local controls | Fresh `Map.get`, fresh `Set` iteration, and `this.#value += 1` rejected | All three accept through separate absence/origin, collection-element, and instance-`this` facts |

The round-two pressure matrix then froze paired hostile/safe cases for:

- three- and four-argument `Reflect.set`, direct/alias/call/apply/bind routes, Proxy/accessor/custom-prototype targets, finite/dynamic/prototype keys, and ordinary owned controls;
- direct assignment, compound/update, `Object.assign`, and `Reflect.set` through one pre-operation `[[Set]]` proof;
- delete, data/accessor/non-writable descriptors, `defineProperty`/`defineProperties`, non-extensibility, branch/try/labeled/short-circuit/abrupt paths, and cold/warm declaration order;
- complete versus partial string/number/symbol key domains and computed descriptor keys;
- `Map`/`Set` content, optionality/absence, strict-null narrowing, arrays, spread, and Bottom-state convergence;
- facade re-exports across local modules, JSX direct/member/spread/`useCallback` handlers, timers/listeners with extra or bound arguments, React effect cleanups, nested/mutually recursive wrappers, repeated registration, and capture mutation before or after registration.

The checked-in structural corpus is now 463/463; the final isolated full structural run completed in 813.55 seconds. Round 2 adds 139 cases to the inherited 324-case suite: 94 rejecting hostile programs and 45 accepting paired safe controls. The unchanged independent reviewer matrix is also final-green: 47/47 hostile programs reject, 20/20 safe programs accept, and all 67 compile under the strict-valid harness with zero mismatches. The corpus keeps the same assertions; only stale 30/40-second per-case limits were raised to 90 seconds for the deeper conservative fixed point.

Independent bounded rechecks were clean on the final source snapshot: the deferred-callback slice was 27/27, the descriptor/must-state slice was 22/22, and the final Bottom/absence slice was 4/4. These are overlapping focused slices of the 463-case checked-in corpus, not additional program-count claims.

## Implemented mechanisms

### Closed inventory and receipts

- `security-source-inventory.mjs` starts from scripts in `index.html`, resolves every reachable local runtime import, and records a deterministic source graph.
- Test-scoped paths are excluded only after they are proven unreachable. A reachable `.test.ts`, `src/test` module, JS/JSX module, or other unsupported runtime extension fails closed.
- Every reachable TS/TSX source requires an analysis receipt. Vite receipt schema v3 records the exact Rollup source-module graph and emitted JavaScript chunk set; the built scanner requires set equality.
- Fresh-build enforcement, source analysis, built-asset inspection, CSP, and browser runtime interception remain independent layers.

### Origin, absence, call, and value transfer

- All declaration, parameter, catch, object/array binding, destructuring-assignment, member-target, loop, direct/compound/update/delete, Object/Reflect, descriptor, collection-mutator, and React-ref channels lower into one write/binding/call model.
- Ambient and opaque origins survive every property/element projection. Casts, generics, aliases, closures, returns, arguments, loops, conditionals, containers, spreads, callbacks, and reassignment cannot erase provenance.
- Optionality is tracked separately from origin. Branch narrowing may remove absence only on a proven path; an absent/Bottom collection result cannot authorize a mutation, while a present fresh `Map.get` result remains owned.
- Function summaries monotonically join observed arguments, captures, overrides, results, and allocation state. Unknown callees, callbacks, constructors, tags, JSX/ref edges, and unsupported strict-TypeScript semantics emit deterministic `HOST_UNKNOWN` diagnostics.
- `call`, `apply`, and `bind` require a non-empty directly analyzed callable set. Reflection results retain opaque provenance, and borrowed/opaque constructors are forbidden.

### Unified `[[Set]]`, descriptor, and prototype policy

- Direct, compound, and update writes, `Object.assign`, and `Reflect.set` use the same receiver/key/ordinary-dispatch validator. `Reflect.set` distinguishes the target from `arguments[3] ?? arguments[0]`, its effective write receiver.
- Mutation is permitted only for proven fresh, unescaped local allocations or explicit UI cells. Passing owned state across an unresolved boundary marks it escaped.
- Key domains carry both a finite set and an all-alternatives-complete bit. A finite branch cannot hide a dynamic branch; strings, numbers, private identities, and symbol alternatives remain distinct.
- Operation proofs are captured before the write and merged monotonically with AND across invocations. A post-write shape, warm replay, later descriptor, or later safe call cannot retroactively authorize an earlier unsafe dispatch.
- Descriptor state distinguishes definitely-present writable data, accessor, absent/invalidated, non-writable, intrinsic/null/custom prototype, and possible non-extensibility. Only proven non-skippable, nonthrowing, must-establishing definitions authorize later dispatch; conditional, abrupt, throwing, or failed definitions do not.
- Prototype-bearing targets reject `__proto__` and unresolved keys. Null-prototype dictionaries accept dynamic keys only when no own accessor/non-writable conflict exists. Getter-free `Object.assign` sources require a complete resolved key domain.

### Deferred callbacks and facade non-leakage

- A deferred registration stores the resolved callable origin plus invocation arguments, bound `this`, site, kind, and structural signature. Repeated equivalent registrations deduplicate without collapsing distinct live mutable allocations.
- Timer/listener, JSX direct/member/spread/ref, typed callback, React effect, and effect-cleanup boundaries enter the same external fixed point. Re-evaluation follows captured-symbol and nested-call dependencies when later actions widen state.
- Facade export reachability follows local imports, re-exports, bound functions, nested shapes, return/default values, closures, and classes instead of filtering by physical filename alone.
- Raw `window`/`document` production references remain confined to `src/platform/browser-capabilities.tsx`. Raw DOM roots, media-query objects, React roots, and capability leaves cannot escape its export surface.

## Deterministic host-effect report

Exact final totals over 52 analyzed production modules:

| Effect | Count |
| --- | ---: |
| `HOST_LOCAL_MUTATION` | 57 |
| `HOST_UI_STATE` | 25 |
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

Receipt totals are 52 analysis receipts, 49 runtime-entry receipts, and 49 bundle-source receipts. Receipt schema v3 records exactly:

- `assets/index-feGJMcbv.js`
- `assets/vendor-react-Bfx28lbG.js`
- `assets/vendor-zod-CwsIYWen.js`

The isolated final production gate completed in 46.62 seconds real time (49.41 seconds user time), with maximum RSS 1,535,655,936 bytes and peak memory footprint 1,588,248,360 bytes.

## Fresh full verification

Fresh `npm run verify` on `670e5de` completed successfully:

| Stage | Result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit/security/component | 28 files, 759 passed, 0 failed |
| Coverage run | 28 files, 759 passed, 0 failed |
| Global coverage | Statements 96.12% (1537/1599); branches 91.58% (1285/1403); functions 98.65% (439/445); lines 97.30% (1408/1447) |
| Build | Vite 8.2.2; 162 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 18 scheduled; 13 passed; 5 intentional project-specific skips; 0 failed |
| Source/effects | 52 analysis receipts; 49 runtime receipts; forbidden 0; unknown 0 |
| Built security | 49 bundle receipts; exact three JS chunks; strict local CSP/assets; zero built network primitives |

The host emitted its existing Playwright `NO_COLOR`/`FORCE_COLOR` warning. The application tour independently asserted zero product console warnings/errors, page errors, unexpected external requests, or runtime capability violations.

The public absent-`dist` proof used a disposable full project. `npm run typecheck` passed, `dist` was confirmed absent, and `npm run test:security` rebuilt 162 modules before the same 52/49/49 source/effect/bundle gate passed. The automated stale-`dist` replacement test also remains green.

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

The final source audit checked the unified dispatch entry points, complete-key propagation, descriptor pre-state, deferred registration/replay roots, facade export traversal, and absence/Bottom handling. Targeted searches found no file/line/test-name source-location allowlisting escape hatch and no syntax-only receiver bypass. `git diff --check` passed before the implementation commit.

Independent reviewers then reran frozen bounded slices on unchanged hashes. No mismatch remained in the enumerated checked-in corpus or the unchanged 67-program reviewer matrix. This is the evidence-backed claim; it does not assert that no program outside the supported subset could ever expose another analyzer defect.

## Bounded guarantee, TCB, and residual risk

The guarantee is closed-world over the current HTML-reachable runtime graph and the strict TS/TSX subset implemented by the analyzer. All current non-test production TS/TSX files are analyzed, and every graph-reachable module must have a receipt. Reachable unsupported extensions/imports and analyzer-recognized unresolved callables, mutations, descriptor/control-flow facts, host effects, or deferred fixed points fail closed. This does not extend the claim to arbitrary syntax or control flow outside the modeled subset.

The trusted computing base is the TypeScript compiler/checker; the inventory, normalizer, origin/effect/descriptor/deferred analysis; explicit summaries and effect budgets; Node path/filesystem canonicalization; the HTML/source-graph parser; and Vite/Rollup's module and output graph used for receipts. The analyzer uses conservative bounded summaries rather than a general JavaScript operational proof.

Third-party implementation semantics and browser correctness remain outside the static proof. Exact built receipts, strict CSP, fresh-build enforcement, asset and unsafe-primitive scanning, and desktop/mobile runtime interception independently bound that residual risk. This is deliberately not a claim to prove arbitrary programs or third-party internals.

No external action was performed and no challenge submission was made.

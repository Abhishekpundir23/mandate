# Task 9 closed-world capability/effect report

Date: 2026-08-31

Plan/base commit: `7eefaee` (source-equivalent architecture base `ae43163`)

Initial Task 9 implementation: `4d030474f3d90329270fed24e398964e4bf31cf6`

Review base: `cace6cd359b8368ffc01ab623e013e2d1602ebdd`

Review-fix round 1: `e51e377d958b2fa0455237a73f5885afe3b1ba6e`

Review-fix round 2 base: `6e9c18a172f42ea50191f98ace0291a5f5ec3a42`

Review-fix round 2 implementation: `670e5de8087a13446eca8c77bad32fe0be540bd8`

Review-fix round 3 frozen RED tests: `82ddfa72e47253bb3ec83257077e7be1c7e274cb`, `0f9f0bcbb44dbd5a336fb53a96e7459078f0ad5f`, `427b953b8a2df3c82af87eea5ba476f4716421d3`, `264de9b2fa4a3f5a265e64da8208c3baeb01c039`, `f6ebb2c1d4506810a659e6517075cc79e1d48507`

Review-fix round 3 implementation: `f820554adf65287e4ab9573d41eac6f41b2e7759`, `b28ef0d68ffd8b939c1174c0cf506bbab9b75713`, `d8138388a7730cc7cb50eb792b587b187ec2c486`

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

Round 3 closes conditional object-spread must-presence, sparse positional argument, and descriptor-enumerability gaps. A shape key is no longer promoted to a definitely copied own property unless it is present and enumerable on every source alternative; array/call sequences preserve holes as explicit `undefined` positions without index compaction; and descriptor/Object.assign evidence is carried through canonical call/alias/apply/bind/helper records. A bounded ordered refresh updates only bindings declared after a descriptor mutation, so later spreads observe the new descriptor state without erasing must-state on an already-mutated receiver.

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

### Review-fix round 3

Round 3 began by freezing the exact reviewer programs before implementation changes.

| Boundary | RED before the mechanism fix | GREEN on final implementation `d8138388a7730cc7cb50eb792b587b187ec2c486` |
| --- | --- | --- |
| Conditional object-spread presence | A may-shape key present on only one branch became a definitely-own target key, accepting direct/alias/call/apply/bind/helper `Reflect.set`, direct assignment, and `Object.assign` | Must-presence intersects all source alternatives; all eight hostile routes reject and the always-present pair accepts |
| Sparse argument containers | Omitted array entries were compacted, shifting the `Reflect.set` key/value/fourth receiver for apply/direct-spread/call-spread/bind-spread | Positional length and holes are preserved; all four sparse routes reject and the dense four-argument control accepts |
| Canonical `Object.assign` sources | Safe call/apply/helper source forms were reread from raw syntax slots and rejected | Canonical getter-free source records follow direct/alias/call/apply/bind/helper routes; all six controls accept |
| Descriptor enumerability | An existing key redefined `enumerable:false` could still authorize a later spread target; normalized safe descriptor calls were rejected from raw argument slots | Possible non-enumerability taints spread must-presence across direct/meta/helper/Reflect/defineProperties routes; normalized true/omitted data descriptors retain precision |
| Ordered descriptor replay | A full post-descriptor binding convergence erased a valid first-statement `try` must-definition | Only later declarations refresh; the two exposed safe controls pass while try/branch/abrupt/failure hostile paths remain closed |

The checked-in structural corpus is now 508/508. Round 3 adds 45 cases to the inherited 463-case suite: 23 rejecting hostile programs and 22 accepting paired safe controls. The final isolated no-filter structural run completed in 865.42 seconds of test time (866.03 seconds wall), with maximum RSS 1,568,014,336 bytes. The unchanged independent 67-program matrix remains exact: 47/47 hostile reject, 20/20 safe accept, every program is strict-TypeScript-valid, and mismatches are zero.

Independent final bounded rechecks on the pinned hashes were also clean. The enumerability/canonical-route matrix was 52/52, and the ordered-convergence matrix was 92/92 (2 safe first-try, 20 hostile try/branch/abrupt/failure, 45 round-3 core, 22 later dependency chains, and 3 contextual warmup cases). These are overlapping focused checks, not additions to the 508 checked-in program count.

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
- Object shape is a may-domain, while spread copy authorization is a separate must-domain: a property is definitely copied only when every alternative proves a present enumerable own data key. Possible non-enumerability survives descriptor aliases, meta-calls, helper calls, joins, snapshots, and replay.
- Positional sequences preserve exact length and omitted entries. A sparse array hole contributes an explicit `undefined` argument at its original index; unresolved positional length or indices fail closed instead of being compacted.
- Function summaries monotonically join observed arguments, captures, overrides, results, and allocation state. Unknown callees, callbacks, constructors, tags, JSX/ref edges, and unsupported strict-TypeScript semantics emit deterministic `HOST_UNKNOWN` diagnostics.
- `call`, `apply`, and `bind` require a non-empty directly analyzed callable set. Reflection results retain opaque provenance, and borrowed/opaque constructors are forbidden.

### Unified `[[Set]]`, descriptor, and prototype policy

- Direct, compound, and update writes, `Object.assign`, and `Reflect.set` use the same receiver/key/ordinary-dispatch validator. `Reflect.set` distinguishes the target from `arguments[3] ?? arguments[0]`, its effective write receiver.
- Mutation is permitted only for proven fresh, unescaped local allocations or explicit UI cells. Passing owned state across an unresolved boundary marks it escaped.
- Key domains carry both a finite set and an all-alternatives-complete bit. A finite branch cannot hide a dynamic branch; strings, numbers, private identities, and symbol alternatives remain distinct.
- Operation proofs are captured before the write and merged monotonically with AND across invocations. A post-write shape, warm replay, later descriptor, or later safe call cannot retroactively authorize an earlier unsafe dispatch.
- Descriptor state distinguishes definitely-present writable data, accessor, absent/invalidated, non-writable, intrinsic/null/custom prototype, and possible non-extensibility. Only proven non-skippable, nonthrowing, must-establishing definitions authorize later dispatch; conditional, abrupt, throwing, or failed definitions do not.
- Descriptor enumerability is a may-fact independent of presence/writability. Canonical descriptor and descriptor-map records, rather than raw syntax argument positions, drive both analysis and scanner diagnostics through direct/alias/call/apply/bind/helper routes.
- Descriptor replay refreshes only declarations ordered after the operation. This lets a later spread observe changed enumerability without letting a speculative pre-operation binding recomputation erase or self-authorize the receiver's operation-indexed proof.
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

- `assets/index-DjUM3jQS.js`
- `assets/vendor-react-Bfx28lbG.js`
- `assets/vendor-zod-CwsIYWen.js`

The isolated final production gate completed in 53.14 seconds real time (56.13 seconds user time), with maximum RSS 1,554,989,056 bytes. The public absent-`dist` build-plus-security command completed in 54.35 seconds with maximum RSS 1,527,300,096 bytes.

## Fresh full verification

Fresh `npm run verify` on the final implementation head `d8138388a7730cc7cb50eb792b587b187ec2c486` completed successfully in 1,914.11 seconds, with maximum RSS 1,576,386,560 bytes:

| Stage | Result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit/security/component | 28 files, 813 passed, 0 failed |
| Coverage run | 28 files, 813 passed, 0 failed |
| Global coverage | Statements 96.15% (1552/1614); branches 91.61% (1301/1420); functions 98.66% (442/448); lines 97.32% (1420/1459) |
| Build | Vite 8.2.2; 162 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 20 scheduled; 14 passed; 6 intentional project-specific skips; 0 failed |
| Source/effects | 52 analysis receipts; 49 runtime receipts; forbidden 0; unknown 0 |
| Built security | 49 bundle receipts; exact three JS chunks; strict local CSP/assets; zero built network primitives |

The host emitted its existing Playwright `NO_COLOR`/`FORCE_COLOR` warning. The application tour independently asserted zero product console warnings/errors, page errors, unexpected external requests, or runtime capability violations.

For the public absent-`dist` proof, the generated `dist` directory was moved aside before invoking `npm run test:security` in the clean checkout. The command rebuilt 162 modules before the same 52/49/49 source/effect/bundle gate passed. The prior generated output was moved to Trash after the fresh build, and the automated stale-`dist` replacement test also remains green.

## Hard six-directory coverage

No source exclusion or threshold change was made. Every required metric is at least 90%:

| Directory | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/domain` | 100.00% | 98.92% | 100.00% | 100.00% |
| `src/mandate` | 97.39% | 92.38% | 100.00% | 97.53% |
| `src/runtime` | 98.20% | 93.61% | 100.00% | 98.14% |
| `src/sandbox` | 96.29% | 92.15% | 96.15% | 97.46% |
| `src/evidence` | 98.21% | 94.44% | 100.00% | 98.14% |
| `src/benchmark` | 95.19% | 91.40% | 98.44% | 97.16% |

## E2E, geometry, and visual invariance

- Playwright: 14 passed, 6 intentional cross-project/single-writer skips, 0 failed.
- Desktop Live: 1586×992; SHA-256 `9ec1085c6dea4e9f4e937022618b9df6db570dbaddd2c6ec7d97a0c98fe50087`.
- Mobile Live: 853×1844; SHA-256 `dc5b4d941bf60e3c137cf526013a04da2acd3e4b853dd768f913e488e501c132`.
- Desktop Benchmark: 1586×992; SHA-256 `63e4bc5cb9411750b080657350dc1540df8206a24751ffd337d7e2c5fc95f7ea`.

The Live desktop/mobile hashes remain identical to the approved Task 8 captures. The benchmark hash changed only with the reviewed accessibility layout: controls measure at least 81.6×44 px, operational metadata is 16 px, the table heading remains sticky, the scrollport has zero horizontal overflow, and all 15 rows are reachable through its deliberate vertical scroll (the last row is not falsely claimed to be fully visible at `scrollTop=0`). The mobile proof asserts zero horizontal overflow, footer alignment at the viewport bottom, and the complete keyboard path.

## Post-GREEN source-level audit

The final source audit checked the unified dispatch entry points, complete-key propagation, descriptor pre-state, deferred registration/replay roots, facade export traversal, and absence/Bottom handling. Targeted searches found no file/line/test-name source-location allowlisting escape hatch and no syntax-only receiver bypass. `git diff --check` passed before the implementation commit.

Independent reviewers then reran frozen bounded slices on unchanged hashes (`security-type-analysis.mjs` `3a2f06cc…`, `security-source-scan.mjs` `ef9464c25…`, and `security-gate.test.ts` `e9f71035…`). No mismatch remained in the 508-case checked-in corpus, the 52/52 enumerability matrix, the 92/92 ordered-convergence matrix, or the unchanged 67-program reviewer matrix. This is the evidence-backed claim; it does not assert that no program outside the supported subset could ever expose another analyzer defect.

## Bounded guarantee, TCB, and residual risk

The guarantee is closed-world over the current HTML-reachable runtime graph and the strict TS/TSX subset implemented by the analyzer. All current non-test production TS/TSX files are analyzed, and every graph-reachable module must have a receipt. Reachable unsupported extensions/imports and analyzer-recognized unresolved callables, mutations, descriptor/control-flow facts, host effects, or deferred fixed points fail closed. This does not extend the claim to arbitrary syntax or control flow outside the modeled subset.

The trusted computing base is the TypeScript compiler/checker; the inventory, normalizer, origin/effect/descriptor/deferred analysis; explicit summaries and effect budgets; Node path/filesystem canonicalization; the HTML/source-graph parser; and Vite/Rollup's module and output graph used for receipts. The analyzer uses conservative bounded summaries rather than a general JavaScript operational proof.

Third-party implementation semantics and browser correctness remain outside the static proof. Exact built receipts, strict CSP, fresh-build enforcement, asset and unsafe-primitive scanning, and desktop/mobile runtime interception independently bound that residual risk. This is deliberately not a claim to prove arbitrary programs or third-party internals.

No external action was performed and no challenge submission was made.

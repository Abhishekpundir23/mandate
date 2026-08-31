# Task 8 implementation and verification report

Date: 2026-08-30

Base: `4048c7e`

Branch: `feat/mandate-local-product`

Scope remained local. No deploy, push, publish, upload, registration, submission, or external-system operation occurred.

## Task 9 supersession note

The Task 8 source-policy implementation, file sizes, 51-module count, 59-negative/15-positive corpus, and source-location reflection exceptions documented below are historical evidence for the Task 8 commit. Task 9 review-fix round 1 (`e51e377d958b2fa0455237a73f5885afe3b1ba6e`), round 2 (`670e5de8087a13446eca8c77bad32fe0be540bd8`), and round 3 (`d8138388a7730cc7cb50eb792b587b187ec2c486`, with mechanism commits `f820554adf65287e4ab9573d41eac6f41b2e7759` and `b28ef0d68ffd8b939c1174c0cf506bbab9b75713`) replace that split syntax-specific policy with one closed-world entry graph and binding/write/call IR, conservative interprocedural origin/effect/descriptor/deferred analysis, all-alternatives spread enumerability, exact positional sequences, canonical mutation records, declarative exact call summaries, exact module/chunk receipts, exact module effect budgets, and a narrow browser facade. The unchanged independent matrix rejects all 47 hostile and accepts all 20 safe programs; the checked-in structural suite is 508/508. The current gate has no file/function/test-name source-location allowlisting escape hatch and reports 52 analysis, 49 runtime, and 49 bundle-source receipts with zero forbidden or unknown effects. Current bounded claims and fresh verification belong to `task-9-report.md`.

## Outcome

Task 8 and fix rounds 1–5/5 are implemented. `npm run verify` remains a non-recursive chain of typecheck, zero-warning lint, unit tests, coverage plus hard per-directory thresholds, one production build, built-preview E2E, and the already-built structural/asset security gate. The public standalone security command performs its own fresh build. The judge-facing benchmark values are imported from the real catalog/evaluator, never handwritten.

## Review-finding closure

1. **Causal initial state.** `useReplay` now begins at frame 0 with `idle`; Live renders `Replay ready` and no submitted/blocked/preserved outcomes or completion receipt before Run. Component, hook, desktop, and mobile tests assert those negative facts. After Run, browser tests require `Replaying` before the final outcome.
2. **Mobile Benchmark reachability.** At widths up to 899px the header has three compact rows: brand/Run, two visible 44px-minimum Live/Benchmark targets, then selector/count. No resize workaround remains. The 390×844 keyboard path reaches Benchmark, Run benchmark, all five sortable headers, row selection, and inspector; axe remains zero serious/critical. Exact 853×1844 geometry is recorded below.
3. **Benchmark fidelity and data reachability.** The 1586×992 table uses 14px single-line rows, a wider failure column, and no desktop horizontal overflow. All 15 row boxes fully intersect the visible scrollport. Failure labels are truthfully derived only by replacing underscores and retain the raw identifier as both accessible name and title; narrow layouts may scroll horizontally.
4. **README truth.** The story now says exactly that canonical v3 is “Do not submit. We haven't built anything.” and does not compile an upload instruction. Standard saves/submits, never inspects, and ends with `nextStepObserved=false`; Mandate alone performs the configured inspect recovery. A source-importing documentation test locks these facts and retains the concept-only fabricated upload-row disclosure.
5. **Proportionate security proof (historical, superseded by Task 9).** Task 8 replaced the regex-only proof with a parsed-config TypeScript `Program`/`TypeChecker` policy over all production TS/TSX plus a closed built-asset policy and a two-viewport runtime tour. Its split scanner/helpers rejected the then-enumerated generic/indexed/callable/constructable/`any`/`unknown`, destructuring, and dynamic-write routes. Task 9 subsequently demonstrated false-greens in that design and replaced it; the old implementation dimensions and route counts are not current guarantees.
6. **Recovery semantics.** Recovery now independently reconstructs the initiating fixture-owned active authority and exact embedded `BLOCK`/`CONFIRM` decision before accepting recovery, then requires declared immediate ordering, correct event type, exact confirmation/finish lifecycle, verified claim evidence, and a full proposal → matching `ALLOW` gate → independently replay-valid observation lifecycle for every recovery action. Missing/forged decision payloads, reordered/early/wrong-event-type, wrong-contract/outcome/fingerprint, and invalid lifecycle traces make both recovery and exact success false; valid action, claim, and finish recoveries remain green.

## Fix round 2 closure

1. **Structural false-greens.** Bare aliases/references, call-return and descriptor leaks, constructors, nested/prototype receiver-independent sinks, import-equals, re-exports, module-require routes, ambient arguments to unknown calls, and unknown nested ambient properties now fail closed. The corpus contains 32 hostile programs plus safe controls for domain words and `operation = 'submit'`.
2. **Stale build.** `test:security` now expands to build → `test:security:built`; `verify` performs its existing single build and invokes only `:built`. A real temporary-project test puts `fetch('/stale-product-endpoint')` in copied `dist` and proves the standalone command rebuilds and removes it before scanning. A direct run beginning with `dist-absent` also passed.
3. **Recovery lifecycle.** `recoverySucceeded` independently checks sequence-derived event id/logical step, prior-world continuity, rejection/proposal pairing, contract version, fixture fingerprint and metadata before accepting recovery. The reviewer mutations `event-impossible`, logical step `999`, and wrong world each make both direct recovery and evaluated recovery false.
4. **Automated keyboard proof.** The E2E journey reaches Benchmark through Tab traversal, then reaches Run benchmark without programmatic focus, asserts focus, activates with Enter on desktop and Space on mobile, observes recomputation, and continues through all sorts, row selection, and inspector.

## Fix round 3 closure

1. **Symbol-aware, reflection-closed source policy (historical).** Task 8 used exact file/function reflection exceptions after distinguishing ambient/lib symbols from local declarations. Task 9 removes those exceptions entirely: standard reflection and descriptor inspection are resolved by declarative semantic summaries and origin rules, while unsupported reflection emits `HOST_UNKNOWN`.
2. **Complete recovery ACTION lifecycle.** A recovery action now requires immediate sequence-derived `ACTION_PROPOSED` → its own immutable fingerprint/contract/metadata-matching `ALLOW` `GATE_DECISION` → its own independently replay-valid `TOOL_OBSERVATION` and world transition. The compound forged gate (`event-impossible`, step 999, `FINISH_EVALUATED`, `BLOCK`, invented operation, contract 999) makes both direct and evaluated recovery false even though the later observation remains independently replay-valid.

## Fix round 4 closure

1. **Dynamic callee and binding patterns.** Unresolved element access now fails closed when the TypeChecker reports callable, constructable, `any`, or `unknown`, whether invoked immediately, assigned, returned, or optional-chained. Dynamic access rooted at the actual global `Object`, `Reflect`, `Function`, `Proxy`, or `globalThis` is also denied, while locally shadowed roots and typed string data indexes remain valid. Nested/default/computed object binding patterns cannot alias receiver-independent capability/reflection sinks. Canonical normalization and capability validation were rewritten to entry iteration/array binding so legitimate production code meets the same rule.
2. **Initiating rejection decision.** Before evaluating recovery, the benchmark rebuilds fixture authority, derives the expected decision from active clauses, and compares the adjacent proposal/rejection identity, world, metadata, fixture contract, outer outcome, canonical fingerprint, clause IDs, reasons, and complete embedded decision. An outer `BLOCK` carrying an embedded forged `ALLOW` no longer counts, nor do missing decisions or forged clauses/reasons/version/fingerprint; the canonical BLOCK regression remains true.

## Fix round 5 closure

1. **Generic/indexed helper provenance.** The TypeChecker policy now rejects unresolved element access whose effective result, receiver, or key carries a type parameter, indexed-access, conditional, or substitution type. Both strict-TypeScript reviewer programs—generic constructor extraction and generic Object prototype/descriptor extraction—fail structurally. There is intentionally no generic helper exemption; safe behavior is expressed with direct, typed local-data access instead.
2. **Destructuring assignments.** Assignment targets are analyzed independently of declaration binding elements. Object and array assignment patterns are recursively unwrapped and checked across static, computed, nested, default, and rest forms; sources must be proven local inert data, and receiver-independent sink names remain denied. Safe local object/array assignment controls pass.
3. **Dynamic writes and receiver provenance.** Unresolved computed assignment, compound assignment, and update targets require a receiver proven locally created and inert. The proof follows parentheses/casts, const and unreassigned-let aliases, and local function returns; symbol reassignment invalidates earlier local provenance. Direct, aliased, helper-returned, and mutable-reassigned DOM receivers therefore fail, while local Record/object/array reads and writes pass.
4. **Recovery scope.** Recovery code and semantics were not changed in this round.

## Genuine RED/GREEN evidence

The fix round started with behavior-led tests before production edits.

- **Combined unit/component/security RED:** 6 files failed; 15 tests failed and 47 passed. Evidence included hook step `23` instead of `0`, pre-click `Replay complete`, both reordered and wrong-type recovery mutations incorrectly returning true, README truth assertions missing, inaccessible raw failure labels, and nine computed/alias structural bypass fixtures passing the old gate.
- **Combined focused GREEN:** the same six files passed, 62/62 tests. The final suite later grew to 294 tests after the valid FINISH recovery regression required by the hard branch threshold.
- **Browser RED/GREEN:** pre-fix browser assertions exposed invisible 0×0 mobile nav, the 15th desktop row crossing the visible scrollport, and future outcome leakage. After the product changes, the focused browser matrix completed with 11 passed/5 expected project skips, followed by the complete final matrix below.
- **Coverage RED/GREEN:** the first post-fix hard gate was RED at `src/benchmark` branches 89.97%. A behavior-led valid ordered FINISH-recovery regression exercised the missing lifecycle branch. GREEN is 90.80% branches for that directory and every required metric is independently at least 90%.
- **Security adversary RED/GREEN:** 13 hostile fixtures cover computed fetch/eval/sendBeacon/storage/innerHTML/location/form submit, ambient alias/destructure, `Reflect`, owner-document escape, forbidden import, and privileged JSX. They failed the pre-structural gate; the focused structural suite is now 14/14 including a positive domain-word/safe-ambient control.
- **Round-2 RED:** the first focused run had 18 failures and 37 passes: 15 newly supplied security/stale-build programs passed the old policy, while the three impossible recovery identity/step/world mutations incorrectly reported recovery success. A second deliberate pressure pass exposed two more nested prototype/module-require false-greens.
- **Round-2 GREEN:** focused structural/recovery is 58/58. The structural file alone is 34/34: 32 hostile programs, one positive control, and one behavioral stale-build command test. The keyboard proof was already product-green and now supplies the missing automated evidence in both viewport projects.
- **Round-3 RED:** after splitting escape routes so one unrelated violation could not mask another, the exact focused run had 7 failures and 63 passes. The old policy accepted the prototype-descriptor optional-setter path, `(() => {}).constructor(...)`, and `new Proxy(...)`; it incorrectly rejected independently shadowed `history`, `location`, and `navigator`; and the forged recovery gate incorrectly left direct recovery success true.
- **Round-3 GREEN:** the focused structural/recovery/evaluator run is 92/92. The structural file is 45/45: 38 independent hostile programs, six positive controls, and one stale-build behavior test. The exact compound nested-return/`Reflect.get`/descriptor-setter/function-constructor fixture remains in the corpus alongside individually isolated routes.
- **Round-4 RED:** the isolated focused run had 15 failures and 75 passes. All nine new static programs passed the previous gate: both exact reviewer routes plus assigned, returned, optional, unknown, global-Object, nested/default-binding, and computed-binding variants. The forged embedded `ALLOW`, missing decision, and four independently corrupted initiating decision fields all incorrectly left direct recovery success true.
- **Round-4 GREEN:** the same structural/recovery files pass 90/90. The structural file is 58/58: 47 independent hostile programs, ten positive controls, and one stale-build behavior test. Direct recovery/evaluator regression is 55/55 after adding fixture-owned behavior coverage for no authority, grant, confirmation, malformed confirmation, conflict, and targeted revocation decisions.
- **Round-4 coverage RED/GREEN:** the first implementation pass correctly triggered the hard directory gate at 87.81% benchmark branches. Centralizing the fixture-owned decision oracle raised it to 89.04% but still failed closed. The authority-variant behavior test raised the final benchmark result to 91.32% branches without exclusions or threshold changes.
- **Round-5 initial RED:** the exact focused run had 11 failures and 61 passes. Both generic/indexed helper programs, four destructuring-assignment routes, and five direct/compound/update/alias/helper-return DOM writes all passed the previous scanner.
- **Round-5 audit RED:** after the first GREEN, an independent mutable receiver initialized locally then reassigned from the DOM still passed; the focused run was 1 failed and 72 passed. Symbol reassignment analysis closed that provenance gap without rejecting an unreassigned local `let` Record.
- **Round-5 GREEN:** the structural file is 75/75: 59 independent hostile programs, 15 positive controls, and one stale-build behavior test. All five exact reviewer reproductions compile under direct strict `tsc` before the scanner rejects them. The public security command also passed from an absent `dist`.

## Fresh full verification

Fresh command after final code, docs, screenshot capture, and report update: `npm run verify`.

| Stage | Fresh result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit | 27 files, 367 passed, 0 failed |
| Global coverage | Statements 95.80% (1508/1574); branches 91.42% (1279/1399); functions 98.37% (425/432); lines 97.06% (1387/1429) |
| Build | Vite 8.2.2; 161 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 18 scheduled across desktop/mobile; 13 passed; 5 intentional project/single-writer skips; 0 failed |
| Security | Historical Task 8 result: 51 production TS/TSX passed its superseded structural policy; closed built inventory passed; zero built network primitives |

The host prints its existing `NO_COLOR`/`FORCE_COLOR` Node warning during Playwright startup. This is not an application console or lint warning. The application runtime tour separately asserts zero console warnings/errors and zero page errors.

## Hard per-directory coverage

Derived from `coverage/coverage-final.json` by `scripts/coverage-directories.mjs`, with no source-file exclusion and an independent 90% gate for every metric:

| Directory | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/domain` | 100.00% | 98.92% | 100.00% | 100.00% |
| `src/mandate` | 97.31% | 92.44% | 100.00% | 97.46% |
| `src/runtime` | 98.20% | 93.61% | 100.00% | 98.14% |
| `src/sandbox` | 96.29% | 92.15% | 96.15% | 97.46% |
| `src/evidence` | 98.18% | 94.35% | 100.00% | 98.11% |
| `src/benchmark` | 95.15% | 91.32% | 98.44% | 97.15% |

## E2E, accessibility, geometry, and runtime-security matrix

| Proof | Desktop | Mobile | Result |
| --- | --- | --- | --- |
| Initial causal state → transient replay → final outcomes | 1586×992 | 390×844 | Ready state has no future outcome/receipt; `Replaying` observed after click; final facts pass |
| Primary navigation and keyboard tour | Full path; Run benchmark activated by Enter | Full path without resize workaround; Run benchmark activated by Space | Live/Benchmark, selector, Run comparison, disclosure/tabs, Run benchmark + recomputation, all 5 sorts, row, inspector reachable solely by traversal |
| Axe flagship/non-flagship Live and Benchmark | Run | Run | 0 serious, 0 critical |
| Exact Benchmark table geometry | 1586×992 | Narrow scrolling checked separately | 15/15 full row intersection; scrollport 1049×596; scrollWidth=clientWidth=1049; last row y=825.5–861.5 inside y=286–882 |
| 200% desktop-equivalent reflow | 793×496 | — | No document horizontal overflow; all primary controls reachable |
| Complete runtime capability tour | All 15 Live scenarios, disclosure/tabs, all 5 sorts twice, all 15 rows, rerun | Same tour at 390×844 | 0 unexpected product requests; 0 fetch/XHR/WS/EventSource/beacon calls; 0 storage/cookie writes; 0 popup/frame/download/navigation/form/unsafe-sink events; 0 console warnings/errors/page errors |
| Exact screenshot capture | One single-writer run | Exact viewport switched within that run | 3 passed capture assertions; expected duplicate project skip |

## Structural and built security matrix

| Layer | Enforced evidence | Result |
| --- | --- | --- |
| Source graph/imports | Every production TS/TSX parses; exact bare allowlist `react`, `react-dom/client`, `zod`; local TS/TSX/CSS imports resolve inside `src`; dynamic import/require/import-equals/re-export/URL/node/unknown bare routes denied | Pass, 51 files |
| Ambient/capability AST | Historical Task 8 policy, superseded by Task 9's uniform IR/origin/effect gate with no source-location allowlisting escape hatch | Historical pass, 59 adversarial negatives + 15 positive controls |
| Build freshness | Standalone `test:security` always rebuilds; already-built subcommand is explicit; stale forbidden `dist` fixture must disappear | Pass in automated stale-dist test and direct absent-dist run |
| Build shape | `modulePreload.polyfill=false`, `assetsInlineLimit=0`, strict CSP; reject unknown extensions/symlinks; HTML/CSS refs must resolve locally; font magic verified | Pass: `.html` 1, `.js` 3, `.css` 1, `.woff` 12, `.woff2` 12 |
| Built text | Zero network primitives, remote imports, product endpoints, credential-shaped material, app dynamic execution, unsafe sinks; narrow inert diagnostic and Zod-jitless allowlists only | Pass |
| Runtime | Built preview only; request/console/CSP/popup/frame/download/capability instrumentation across complete desktop/mobile tours | Pass, zero recorded violations |

## Browser-first route and fallback

The in-app Browser route was attempted first against the built local preview. Runtime setup succeeded, but the exact `iab` selector returned `Browser is not available: iab`. Following the Browser skill's recovery path, bootstrap troubleshooting was read and browser discovery was performed once; it returned an empty list (`[]`). Because the task explicitly requires the in-app Browser path, no unrelated browser surface was substituted.

The permitted Playwright built-preview fallback then completed the full DOM, accessibility, geometry, console, and security tour. Final fallback evidence: zero application console warning/error, zero page error, zero unexpected same-origin or cross-origin request, and zero runtime-capability violation.

## Screenshot and visual evidence

All concept and final render images were viewed after the final capture. Captures use reduced motion, `document.fonts.ready`, settled replay/tab paint, and `fullPage:false`.

Round-5 E2E recapture remained pixel-identical because the fixes are source-policy only: desktop Live SHA-256 `9ec1085c6dea4e9f4e937022618b9df6db570dbaddd2c6ec7d97a0c98fe50087`, mobile Live `dc5b4d941bf60e3c137cf526013a04da2acd3e4b853dd768f913e488e501c132`, and desktop Benchmark `c1eef2d3384795604d6866c4a382203896f35384b55640a4b8ec8e0b91d99078`.

| Artifact | Dimensions | Geometry proof |
| --- | ---: | --- |
| `outputs/mandate-live-desktop-1586x992.png` | 1586×992 | Three-rail Live composition; semantic dark status text; final causal outcomes/receipt |
| `outputs/mandate-live-mobile-853x1844.png` | 853×1844 | Header 853×179; document 853×1844; footer y=1764–1844; zero horizontal/vertical overflow beyond viewport |
| `outputs/mandate-benchmark-desktop-1586x992.png` | 1586×992 | Table scrollport y=286–882; all 15 rows fully visible; footer y=930–992 |

The fidelity ledger records all 15 checkpoints and truth-first deviations. In particular, the concept's fabricated `REVOKED — Publish or upload` row is absent because canonical v3 compiles no upload instruction. No fabricated timestamps, friendly evidence aliases, provenance, or checksums were introduced.

## Documentation and hygiene

- README Quick start contains exactly three commands.
- Demo timing is exactly 15 + 35 + 25 + 15 = 90 seconds.
- README and methodology metrics are source-imported/tested: Standard 5/15, Mandate 15/15, unauthorized effects 8/0, false claims 3/0.
- The security details in this Task 8 report are historical. `docs/architecture.md` now records Task 9's current uniform origin/effect/descriptor/deferred boundary, exact entry/bundle receipts, and lack of source-location exceptions.
- `docs/benchmark-methodology.md` defines independent initiating-decision reconstruction, the immediate full ACTION recovery lifecycle, and claim evidence verification.
- Generated `dist`, coverage, Playwright traces/reports, and screenshots remain untracked; screenshots exist only in the authorized output directory.
- `git diff --check` and post-commit status are recorded in the handoff.

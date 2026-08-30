# Task 8 implementation and verification report

Date: 2026-08-30

Base: `4048c7e`

Branch: `feat/mandate-local-product`

Scope remained local. No deploy, push, publish, upload, registration, submission, or external-system operation occurred.

## Outcome

Task 8 and fix rounds 1–2/5 are implemented. `npm run verify` remains a non-recursive chain of typecheck, zero-warning lint, unit tests, coverage plus hard per-directory thresholds, one production build, built-preview E2E, and the already-built structural/asset security gate. The public standalone security command performs its own fresh build. The judge-facing benchmark values are imported from the real catalog/evaluator, never handwritten.

## Review-finding closure

1. **Causal initial state.** `useReplay` now begins at frame 0 with `idle`; Live renders `Replay ready` and no submitted/blocked/preserved outcomes or completion receipt before Run. Component, hook, desktop, and mobile tests assert those negative facts. After Run, browser tests require `Replaying` before the final outcome.
2. **Mobile Benchmark reachability.** At widths up to 899px the header has three compact rows: brand/Run, two visible 44px-minimum Live/Benchmark targets, then selector/count. No resize workaround remains. The 390×844 keyboard path reaches Benchmark, Run benchmark, all five sortable headers, row selection, and inspector; axe remains zero serious/critical. Exact 853×1844 geometry is recorded below.
3. **Benchmark fidelity and data reachability.** The 1586×992 table uses 14px single-line rows, a wider failure column, and no desktop horizontal overflow. All 15 row boxes fully intersect the visible scrollport. Failure labels are truthfully derived only by replacing underscores and retain the raw identifier as both accessible name and title; narrow layouts may scroll horizontally.
4. **README truth.** The story now says exactly that canonical v3 is “Do not submit. We haven't built anything.” and does not compile an upload instruction. Standard saves/submits, never inspects, and ends with `nextStepObserved=false`; Mandate alone performs the configured inspect recovery. A source-importing documentation test locks these facts and retains the concept-only fabricated upload-row disclosure.
5. **Proportionate security proof.** The old regex-only proof is replaced by a TypeScript AST/import/capability policy over all production TS/TSX plus a closed built-asset policy and a two-viewport runtime tour. The implementation is split into a 236-line AST/orchestrator, 61-line source allowlist/import policy, and 86-line built-asset policy. The claim is deterministic structural-plus-runtime enforcement, not mathematical impossibility.
6. **Recovery semantics.** Recovery now requires a matching rejection first, declared ordering, correct event type, exact confirmation/finish lifecycle, verified claim evidence, and a later independently valid action observation. Reordered, early, wrong-event-type, and invalid lifecycle traces make both recovery and exact success false; valid action, claim, and finish recoveries remain green.

## Fix round 2 closure

1. **Structural false-greens.** Bare aliases/references, call-return and descriptor leaks, constructors, nested/prototype receiver-independent sinks, import-equals, re-exports, module-require routes, ambient arguments to unknown calls, and unknown nested ambient properties now fail closed. The corpus contains 32 hostile programs plus safe controls for domain words and `operation = 'submit'`.
2. **Stale build.** `test:security` now expands to build → `test:security:built`; `verify` performs its existing single build and invokes only `:built`. A real temporary-project test puts `fetch('/stale-product-endpoint')` in copied `dist` and proves the standalone command rebuilds and removes it before scanning. A direct run beginning with `dist-absent` also passed.
3. **Recovery lifecycle.** `recoverySucceeded` independently checks sequence-derived event id/logical step, prior-world continuity, rejection/proposal pairing, contract version, fixture fingerprint and metadata before accepting recovery. The reviewer mutations `event-impossible`, logical step `999`, and wrong world each make both direct recovery and evaluated recovery false.
4. **Automated keyboard proof.** The E2E journey reaches Benchmark through Tab traversal, then reaches Run benchmark without programmatic focus, asserts focus, activates with Enter on desktop and Space on mobile, observes recomputation, and continues through all sorts, row selection, and inspector.

## Genuine RED/GREEN evidence

The fix round started with behavior-led tests before production edits.

- **Combined unit/component/security RED:** 6 files failed; 15 tests failed and 47 passed. Evidence included hook step `23` instead of `0`, pre-click `Replay complete`, both reordered and wrong-type recovery mutations incorrectly returning true, README truth assertions missing, inaccessible raw failure labels, and nine computed/alias structural bypass fixtures passing the old gate.
- **Combined focused GREEN:** the same six files passed, 62/62 tests. The final suite later grew to 294 tests after the valid FINISH recovery regression required by the hard branch threshold.
- **Browser RED/GREEN:** pre-fix browser assertions exposed invisible 0×0 mobile nav, the 15th desktop row crossing the visible scrollport, and future outcome leakage. After the product changes, the focused browser matrix completed with 11 passed/5 expected project skips, followed by the complete final matrix below.
- **Coverage RED/GREEN:** the first post-fix hard gate was RED at `src/benchmark` branches 89.97%. A behavior-led valid ordered FINISH-recovery regression exercised the missing lifecycle branch. GREEN is 90.80% branches for that directory and every required metric is independently at least 90%.
- **Security adversary RED/GREEN:** 13 hostile fixtures cover computed fetch/eval/sendBeacon/storage/innerHTML/location/form submit, ambient alias/destructure, `Reflect`, owner-document escape, forbidden import, and privileged JSX. They failed the pre-structural gate; the focused structural suite is now 14/14 including a positive domain-word/safe-ambient control.
- **Round-2 RED:** the first focused run had 18 failures and 37 passes: 15 newly supplied security/stale-build programs passed the old policy, while the three impossible recovery identity/step/world mutations incorrectly reported recovery success. A second deliberate pressure pass exposed two more nested prototype/module-require false-greens.
- **Round-2 GREEN:** focused structural/recovery is 58/58. The structural file alone is 34/34: 32 hostile programs, one positive control, and one behavioral stale-build command test. The keyboard proof was already product-green and now supplies the missing automated evidence in both viewport projects.

## Fresh full verification

Fresh command after final code, docs, screenshot capture, and report update: `npm run verify`.

| Stage | Fresh result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit | 27 files, 317 passed, 0 failed |
| Global coverage | Statements 95.87% (1489/1553); branches 91.32% (1231/1348); functions 98.36% (420/427); lines 96.87% (1366/1410) |
| Build | Vite 8.2.2; 160 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 18 scheduled across desktop/mobile; 13 passed; 5 intentional project/single-writer skips; 0 failed |
| Security | 50 production TS/TSX passed structural policy; closed built inventory passed; zero built network primitives |

The host prints its existing `NO_COLOR`/`FORCE_COLOR` Node warning during Playwright startup. This is not an application console or lint warning. The application runtime tour separately asserts zero console warnings/errors and zero page errors.

## Hard per-directory coverage

Derived from `coverage/coverage-final.json` by `scripts/coverage-directories.mjs`, with no source-file exclusion and an independent 90% gate for every metric:

| Directory | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/domain` | 100.00% | 98.92% | 100.00% | 100.00% |
| `src/mandate` | 97.31% | 92.39% | 100.00% | 97.46% |
| `src/runtime` | 98.20% | 93.61% | 100.00% | 98.14% |
| `src/sandbox` | 96.29% | 92.15% | 96.15% | 97.46% |
| `src/evidence` | 98.18% | 94.35% | 100.00% | 98.11% |
| `src/benchmark` | 95.39% | 91.00% | 98.40% | 96.46% |

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
| Source graph/imports | Every production TS/TSX parses; exact bare allowlist `react`, `react-dom/client`, `zod`; local TS/TSX/CSS imports resolve inside `src`; dynamic import/require/import-equals/re-export/URL/node/unknown bare routes denied | Pass, 50 files |
| Ambient/capability AST | Resolves literals, templates, parentheses, const identifiers, and string concatenation; denies bare aliases/references, constructors, ambient returns/arguments/descriptors, unknown computed ambient access, aliases/destructuring/assignment, `Reflect`, network/persistence/eval/unsafe HTML/navigation/form/escape properties, and privileged JSX/elements | Pass, 32 adversarial negatives + positive domain-word control |
| Build freshness | Standalone `test:security` always rebuilds; already-built subcommand is explicit; stale forbidden `dist` fixture must disappear | Pass in automated stale-dist test and direct absent-dist run |
| Build shape | `modulePreload.polyfill=false`, `assetsInlineLimit=0`, strict CSP; reject unknown extensions/symlinks; HTML/CSS refs must resolve locally; font magic verified | Pass: `.html` 1, `.js` 3, `.css` 1, `.woff` 12, `.woff2` 12 |
| Built text | Zero network primitives, remote imports, product endpoints, credential-shaped material, app dynamic execution, unsafe sinks; narrow inert diagnostic and Zod-jitless allowlists only | Pass |
| Runtime | Built preview only; request/console/CSP/popup/frame/download/capability instrumentation across complete desktop/mobile tours | Pass, zero recorded violations |

## Browser-first route and fallback

The in-app Browser route was attempted first against the built local preview. Runtime setup succeeded, but the exact `iab` selector returned `Browser is not available: iab`. Following the Browser skill's recovery path, bootstrap troubleshooting was read and browser discovery was performed once; it returned an empty list (`[]`). Because the task explicitly requires the in-app Browser path, no unrelated browser surface was substituted.

The permitted Playwright built-preview fallback then completed the full DOM, accessibility, geometry, console, and security tour. Final fallback evidence: zero application console warning/error, zero page error, zero unexpected same-origin or cross-origin request, and zero runtime-capability violation.

## Screenshot and visual evidence

All concept and final render images were viewed after the final capture. Captures use reduced motion, `document.fonts.ready`, settled replay/tab paint, and `fullPage:false`.

| Artifact | Dimensions | Geometry proof |
| --- | ---: | --- |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-live-desktop-1586x992.png` | 1586×992 | Three-rail Live composition; semantic dark status text; final causal outcomes/receipt |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-live-mobile-853x1844.png` | 853×1844 | Header 853×179; document 853×1844; footer y=1764–1844; zero horizontal/vertical overflow beyond viewport |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-benchmark-desktop-1586x992.png` | 1586×992 | Table scrollport y=286–882; all 15 rows fully visible; footer y=930–992 |

The fidelity ledger records all 15 checkpoints and truth-first deviations. In particular, the concept's fabricated `REVOKED — Publish or upload` row is absent because canonical v3 compiles no upload instruction. No fabricated timestamps, friendly evidence aliases, provenance, or checksums were introduced.

## Documentation and hygiene

- README Quick start contains exactly three commands.
- Demo timing is exactly 15 + 35 + 25 + 15 = 90 seconds.
- README and methodology metrics are source-imported/tested: Standard 5/15, Mandate 15/15, unauthorized effects 8/0, false claims 3/0.
- `docs/architecture.md` describes the proportionate structural-plus-runtime policy and zero-network-primitive build.
- `docs/benchmark-methodology.md` defines ordered causal recovery and claim evidence verification.
- Generated `dist`, coverage, Playwright traces/reports, and screenshots remain untracked; screenshots exist only in the authorized output directory.
- `git diff --check` and post-commit status are recorded in the handoff.

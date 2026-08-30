# Task 8 implementation and verification report

Date: 2026-08-30

Base: `4048c7e`

Branch: `feat/mandate-local-product`
Scope boundary: local implementation and verification only. No deploy, publish, upload, push, registration, external action, or submission control was used.

## Outcome

Task 8 is implemented. The complete non-recursive gate `npm run verify` passed fresh after the final code, documentation, responsive, and screenshot-settling changes. The benchmark headline is computed from imported catalog/evaluator output and locked into the judge-facing documentation by a test.

## Files changed

- Judge documentation: `README.md`, `docs/architecture.md`, `docs/benchmark-methodology.md`, `docs/demo-script.md`, `docs/fidelity-ledger.md`.
- Browser verification: `playwright.config.ts`, `e2e/mandate.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/offline-security.spec.ts`, `e2e/screenshots.spec.ts`, and the deliberately extended `e2e/benchmark-accessibility.spec.ts`.
- Gates/tooling: `package.json`, `package-lock.json`, `vite.config.ts`, `scripts/coverage-directories.mjs`, `scripts/security-gate.mjs`.
- Behavioral coverage: `src/benchmark/adversarial.test.ts`, `src/benchmark/documentation.test.ts`, `src/domain/canonical.test.ts`, `src/domain/predicates.test.ts`, `src/domain/schema.test.ts`, `src/evidence/receipt.test.ts`, `src/mandate/confirmation.test.ts`, `src/mandate/gate.test.ts`, `src/mandate/ledger.test.ts`, `src/runtime/replay.test.ts`, `src/runtime/runner.test.ts`, `src/sandbox/execute.test.ts`.
- Minimal production correction: `src/benchmark/fixture-evaluator.ts` now rejects an event that is not a member of its trace before reading a predecessor world.
- Accessibility/fidelity/responsiveness: `src/styles/benchmark-table.css`, `src/styles/benchmark.css`, `src/styles/history.css`, `src/styles/live.css`, `src/styles/responsive.css`, `src/styles/trace.css`.
- This evidence record: `.superpowers/sdd/2026-08-29-mandate-local-product/task-8-report.md`.

Generated `dist/`, `coverage/`, Playwright reports/traces, and screenshots are not tracked. The three final screenshots live only in the authorized outputs directory.

## Genuine RED/GREEN evidence

### E2E/accessibility RED

The first new `npm run test:e2e` run was RED: 16 scheduled, 3 failed, 9 passed, 4 skipped. Axe exposed serious `color-contrast` failures in real Live states, including history/status/action text, authority labels, and receipt text. A separate hidden-panel assertion was corrected to query the intended DOM rather than weakening the accessibility requirement.

The minimal product correction introduced dark semantic green/red text tokens and a 16px action-status size while preserving the approved bright colors for non-text borders/icons. Focused GREEN: 7 passed, 3 intentionally skipped across the selected Live/accessibility specs. The final full matrix is below.

### Adversarial evaluator RED

A behavior-led copied-event test passed a detached but structurally valid observation to `executionIsValid`. RED was a real crash: `TypeError: Cannot read properties of undefined (reading 'world')`, caused by `trace.events.indexOf(event) === -1`. The fix is one fail-closed membership guard. Focused GREEN: `src/benchmark/adversarial.test.ts`, 18 passed.

### Coverage RED

With every TypeScript/TSX source file included, the first hard per-directory run failed because `src/evidence` branch coverage was 88.70%. New tests exercised selector-based `REVOKED` evidence, malformed authority/receipt events, and other observable adversarial paths. GREEN is the raw-JSON-derived matrix below; no required directory, source file, or metric was excluded.

### Reflow RED

After the exact 853px mobile correction, full E2E found the 793×496 (200% desktop-equivalent) view had inherited hidden destination navigation: 1 failed, 10 passed, 5 skipped. The responsive rule now distinguishes a tall mobile capture from a short zoom/reflow viewport. Focused GREEN: the 793×496 test passed, with zero body/root horizontal overflow and reachable Benchmark controls.

### Screenshot settle RED

The final-image review found the mobile DOM displaying the Mandate trace while the prior Standard selection paint was still visible. The screenshot journey now waits for both `aria-selected=true` and computed cobalt text before capture. GREEN: screenshot spec 1 passed; the regenerated 853×1844 image was viewed again and has consistent Mandate selection/content.

## Fresh full verification output

Fresh command: `npm run verify`

Exit: 0

The script expanded, without recursion, to typecheck → zero-warning lint → unit → coverage plus per-directory gate → production build → built-preview E2E → security gate.

| Stage | Complete fresh output summary |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, exit 0, zero warnings/errors |
| Unit | 26 test files passed; 274 tests passed; 0 failed; 2.52s |
| Coverage | 26 test files passed; 274 tests passed; global statements 96.04% (1456/1516), branches 91.52% (1188/1298), functions 98.34% (415/422), lines 97.02% (1335/1376) |
| Build | Vite 8.2.2; 160 modules transformed; `index-CuZTC4ct.js` 369.68 kB (107.82 kB gzip); exit 0 |
| E2E | 16 scheduled across two projects; 11 passed; 5 intentional project/single-run skips; 0 failed; 11.2s |
| Security | 49 production source files passed deny scan; 1 production JS bundle; exactly one Vite module-preload fallback fetch; diagnostic metadata allowlist only |

Playwright printed the host environment's existing `NO_COLOR`/`FORCE_COLOR` Node warning. This is not an application lint warning; the zero-warning ESLint stage passed independently.

## Hard per-directory coverage

Computed from `coverage/coverage-final.json` by `scripts/coverage-directories.mjs`; each metric independently gates at 90%.

| Directory | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/domain` | 100.00% | 98.92% | 100.00% | 100.00% |
| `src/mandate` | 97.31% | 92.39% | 100.00% | 97.46% |
| `src/runtime` | 98.20% | 93.61% | 100.00% | 98.14% |
| `src/sandbox` | 96.29% | 92.15% | 96.15% | 97.46% |
| `src/evidence` | 98.18% | 94.35% | 100.00% | 98.11% |
| `src/benchmark` | 96.03% | 91.74% | 98.34% | 97.02% |

## E2E and axe matrix

| Proof | Desktop project | Mobile project | Result |
| --- | --- | --- | --- |
| Live causal replay → Standard submitted / Mandate blocked / exact receipt → 15-row Benchmark → deterministic rerun | Run | Deliberately skipped as desktop journey | Pass; includes a post-click `Replaying` transition, not only initially rendered final text |
| Mobile Run → arrow-key Standard/Mandate → one visible panel → stacked authority/receipt | Deliberately skipped as mobile journey | Run at 390×844 | Pass |
| 200% desktop-equivalent reflow | Run at 793×496 | Deliberately skipped as single reflow proof | Pass; no page clipping and destinations/sort/row/inspector reachable |
| Keyboard-only journey | Header nav, selector, Run, disclosure, Benchmark sort/row/inspector | Selector, Run, disclosure, trace tabs | Pass in both projects |
| Axe flagship Live | Run | Run | 0 serious, 0 critical |
| Axe non-flagship Live | Run | Run | 0 serious, 0 critical |
| Axe flagship Benchmark selection | Run | Run at mobile layout | 0 serious, 0 critical |
| Axe non-flagship Benchmark selection | Run | Run at mobile layout | 0 serious, 0 critical |
| Cross-origin abort control tour | Run | Deliberately skipped as one complete control tour | Pass; intercepted external-request list remained empty |
| Exact screenshot capture | Run once, changing exact viewports | Deliberately skipped to prevent duplicate writers | Pass |

The additional retained `benchmark-accessibility.spec.ts` separately scans both flagship and non-flagship selected Benchmark states in both projects. Vitest excludes `e2e/**`; Playwright is the only runner for these browser specs.

## Browser-first route and fallback evidence

The in-app Browser skill was used first with the documented Node REPL client and explicit `iab` runtime against the built local preview at `http://127.0.0.1:4173/`.

- Local app loaded with title `MANDATE`, meaningful DOM, no framework error overlay, and no console warning/error.
- Live Run produced `APPLICATION SUBMITTED`, `BLOCKED by mandate v3`, and the exact completion receipt. The first text wait for `Exact mandate satisfied` timed out even though a subsequent fresh DOM snapshot showed the completed replay. Recovery followed the Browser guide: inspect fresh DOM and logs rather than blindly repeat the action; state and logs proved completion.
- Benchmark showed 15 `tbody tr` rows. Rerun preserved `seed 2bad36dc · catalog af5f546f · proposals 1ef5880f · traces 1c48b617`; logs remained clean.
- Browser viewport control accepted 1586×992 and 853×1844. Its screenshot endpoint nevertheless capped the requested mobile artifact at 853×1200, verified with `sips`, so it could not produce the binding exact mobile evidence. Under the brief's permitted recovery, regular Playwright captured all three exact non-stitched viewports with reduced motion, fonts ready, replay/selection paint settled, and `fullPage: false`.

## Screenshot evidence

All approved concept images and all final render images were viewed. Final dimensions were re-read with `sips` after the last capture.

| Artifact | Exact dimensions |
| --- | ---: |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-live-desktop-1586x992.png` | 1586×992 |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-live-mobile-853x1844.png` | 853×1844 |
| `/Users/abhi/Documents/Codex/2026-08-29/hey/outputs/mandate-benchmark-desktop-1586x992.png` | 1586×992 |

The fidelity ledger records all 15 binding checkpoints. It explicitly identifies truth-first deviations: no fabricated timestamps; no fabricated `REVOKED — Publish or upload` authority row; v3 shows the actual canonical denial while the v2 inspection permission remains in v2; raw fixture identifiers, evidence provenance, and checksums are not replaced with invented presentation data.

## Offline and security evidence

- Browser interception wrapped the meaningful control tour and aborted every origin other than the built local preview. Observed external requests: 0.
- Source gate scanned 49 production TS/TSX files for product network APIs/endpoints, browser persistence, private-key/API-key signatures, dynamic execution, unsafe HTML, navigation APIs, and form submission. Result: pass.
- Built-bundle gate scanned the actual preview bundle. Result: one JS bundle, exactly one Vite module-preload fallback `fetch`, only inert React/W3C/JSON-Schema diagnostic URL metadata, and no product endpoint, storage API, credential signature, or additional egress primitive.
- The secret scan targets credential-shaped material; it does not naïvely ban ordinary domain words such as “token.”
- The sandbox remains immutable and in-memory. No real integration or external system was operated.

## Documentation checklist

- README starts with the thesis and its Quick start contains exactly three commands: clean install, complete verify, local dev.
- Flagship story and explicit no-real-action/no-submission boundary are present.
- Benchmark headline is imported/computed from the real evaluator and catalog, then checked against README and methodology by `src/benchmark/documentation.test.ts`: Standard 5/15, Mandate 15/15, unauthorized effects 8/0, false claims 3/0.
- Reproducibility describes seed, catalog, proposal, and trace checksums.
- Architecture documents the causal chain and six trust boundaries.
- Methodology defines exact formulas, fixture/evaluator independence, parity, and checksum construction.
- Fidelity ledger contains 15 measured or intentional-deviation checkpoints and the required truth-first disclosures.
- Demo timing is exactly 15 + 35 + 25 + 15 = 90 seconds.

## Final repository hygiene before commit

`git diff --check` exited 0. Generated reports/traces are ignored and not staged. The worktree intentionally contains only the Task 8 source, test, gate, and documentation changes listed above plus this report; the final post-commit status and commit hash are recorded in the handoff.

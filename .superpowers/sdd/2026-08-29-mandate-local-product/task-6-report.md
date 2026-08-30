# Task 6 report: Live run interface and deterministic replay

## Outcome

Implemented the Live run product surface from the approved desktop and mobile concepts. React renders the comparison runner's contract versions, trace events, active clauses, outcomes, and receipt; it does not derive policy decisions or benchmark metrics. The flagship fixture was also aligned, under the controller's focused authorization, to the grounded three-turn causal story used by the interface.

## TDD evidence

### RED

- Added `useReplay.test.tsx`, `AccessibleTabs.test.tsx`, and `LiveRunView.test.tsx` before their production modules. The first focused run failed in three suites because `useReplay`, `AccessibleTabs`, and `LiveRunView` did not exist.
- Added `application.test.ts` before aligning the fixture. Its first run produced three expected failures: the old turn copy, pre-block inspection order, and Standard `nextStepObserved` state did not match the approved causal story.
- Added breakpoint and non-flagship assertions before the responsive/generic rendering refactor. The run produced three expected failures: compact markup exposed the wrong panel structure and non-flagship output retained flagship presentation assumptions.
- Added an authority-priority assertion before changing presentation order. `LiveRunView.test.tsx` failed readably with `expected 83 to be less than 37`, proving that `EVIDENCE` appeared before `MUST NOT` in emitted insertion order.

### GREEN and refactor

- `useReplay` uses a reducer plus one cancellable interval effect. Run resets to frame zero, advances ordered frames, cancels on reset/completion/unmount/frame change, and immediately finishes for reduced motion.
- Desktop uses direct Standard and Mandate regions. Tablet/mobile use a real two-tab control with one selected tabpanel, roving focus, Left/Right and Home/End handling, and linked tab/panel IDs.
- Flagship authority rows are selected from actual active clauses and presented as `MUST`, `MAY`, `MUST NOT`, `EVIDENCE`; no `REVOKED` or upload authority is fabricated. Other scenarios use their engine clauses and generic outcomes/receipts.
- CSS was refactored into `shell.css`, `live.css`, `history.css`, `trace.css`, and `responsive.css`; every production module and stylesheet remains below 250 lines.
- Final focused Task 6 gate: 4 files, 16 tests passed; typecheck and lint clean; production build succeeded.

## Authorized fixture alignment

- Turn 1 is `Fill the application and save a draft.` with grounded fill/save requirements and draft evidence.
- Turn 2 is `Done — now see what's next.` with `MAY` inspect-next-step (`inspect-next-step-may`).
- Turn 3 is `Do not submit. We haven't built anything.` with `MUST_NOT` submit and submission evidence.
- Shared main program is fill fields, save draft, attempt submit after v3, finish. Standard submits and does not run recovery. Mandate blocks submit, inspects the next step, then emits the evidence-backed preserved-draft claim.
- Ungrounded upload prohibition/evidence was removed. The inert terminal-world `uploads: 0` fact remains only for exact-state equality and is not presented as requested evidence.
- Benchmark headline remains Standard 5/15 exact, 8 unauthorized effects, 3 false claims versus Mandate 15/15, 0, 0. Checksums remain deterministic.

## Visual and accessibility decisions

- Inspected `live-desktop.png` and `live-mobile.png` at original size in the implementation pass.
- Preserved the 88px desktop header, approximately 26/49/25 ruled rails, mirrored execution lanes, and a dedicated 62px footer row. Final desktop browser geometry was header `0–88`, main `88–930`, footer `930–992` at 1586×992.
- Used the locked local IBM Plex Mono and Roboto Condensed fonts and the specified canvas, ink, rule, cobalt, green, red, and CTA tokens. There are no gradients, glass effects, pill badges, card grids, emoji, or fake timestamps.
- Mobile hides prior versions, tool labels, arguments, desktop-only receipt facts, and the inactive lane. Controls meet the 44px target; focus uses a visible cobalt outline.
- The concept's illustrative data yields to runtime truth: the green inspect diff belongs to v2, the red submit prohibition to v3, recovery is `inspect_next_step`, and engine-backed draft evidence replaces the invalid `REVOKED Publish or upload` row.
- Semantic output includes `header`, labelled primary `nav`, labelled `main`, complementary rails, `footer`, a real disclosure, restrained polite status, and inline 2px-stroke SVG status icons.

## Browser interaction evidence

- Exercised the local app in the in-app browser only; no deployment or external action occurred.
- At 430 CSS px, arrow-key tab switching selected Mandate and exposed exactly one tabpanel.
- Run entered `Replaying 1 of 22 events` with the control disabled, then reached `Replay complete` and re-enabled the control.
- Selecting the release scenario reset to `Replay ready`; after completion it rendered the release instruction/outcome without `APPLICATION SUBMITTED`, `DRAFT PRESERVED`, `draft_saved`, or `observed_state` falsehoods.
- Mobile DOM geometry contained exactly one authority matrix, receipt, and footer in normal flow. The in-app browser's `fullPage` capture path duplicated a lower tile; a fresh non-stitched viewport capture was clean. This was a capture-stitching artifact, not duplicated DOM or layout. Task 8 should create the final visual-fidelity artifacts using non-stitched captures.

## Final verification

All commands ran from the repository root on the final working tree:

```text
npm test -- --run src/app src/components/live src/components/primitives && npm run typecheck && npm run lint && npm run build
  4 test files passed; 16 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

npm test -- --run src/scenarios src/benchmark src/runtime src/evidence
  6 test files passed; 69 tests passed

npm run verify
  18 test files passed; 166 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

git diff --check
  clean
```

`git diff --cached --check` is recorded after staging and before the task commit.

## Concerns

- No product or data-contract blocker remains.
- Task 8 still owns final screenshot comparison and may choose separate, non-stitched mobile viewport captures to avoid the in-app browser's full-page tiling artifact.

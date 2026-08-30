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

## Fix round 1/5: prefix truth and semantic replay

### RED evidence

- Runtime and receipt tests were written first. The first readable run had four expected failures: shared semantic work appeared at raw frame 2 versus 4, `ReplayFrame` had no engine-owned action view or frame-local authority fields, and `CompletionReceipt` had no scalar unauthorized/unmet counts.
- UI and accessibility tests were then written before their production changes. Eight assertions failed readably for receipt scalar rendering, persistent tabpanels, explicit action-status text, frame-local history, persistent disclosure targets, compact active-authority provenance, and generic real-diff/`NO_CHANGE` rendering.
- A local browser regression check measured replay metadata at `12px` before the stylesheet correction. The same check measured `16px` after GREEN.
- The non-reduced-motion replay test now gives only `(prefers-reduced-motion: reduce)` a non-match and observes timer-driven progression. It no longer makes every media query match.

### GREEN behavior

- Replay alignment now advances by semantic milestones. Shared `fill-fields`, `save-draft`, and `submit-application` proposal and gate-decision milestones appear together even when Mandate emits extra contract/diff events; Mandate-only rejection recovery follows the shared block point. The final frame still deep-equals both complete `RuntimeTrace` values.
- Each prefix exposes immutable runtime-owned action views. An action is `pending` until observation; Standard's unauthorized `submit_application` becomes `unauthorized` immediately when its observation enters the prefix and never renders as success. React maps those statuses to visible or screen-reader text without recomputing policy.
- Each frame also owns its current contract versions, active clauses, and authority changes. Frame zero exposes no future v3 state. The v2 `MAY inspect next step` provenance remains in v2, the v3 `MUST_NOT submit application` provenance remains in v3, and the compact v3 surface separately summarizes both currently active facts without rewriting either diff.
- Generic scenarios render their actual engine `IntentDiff` operations. `NO_CHANGE` versions keep their emitted reason/provenance and say `No authority change`; real changes render their actual added/revoked clauses.
- Both tabpanel targets remain mounted and the inactive panel is `hidden`; exactly one is accessible. History disclosure targets likewise remain mounted with `hidden` while collapsed. Action statuses are explicit text, icons remain decorative, and desktop replay metadata is `16px`.
- `CompletionReceipt` exposes `unauthorizedEffectCount` and `unmetClauseCount` as engine/view-model scalar fields. `CompletionReceipt.tsx` renders those fields and performs no array-length metric calculation.

### Changed engine and UI interfaces

- `CompletionReceipt`: added scalar `unauthorizedEffectCount` and `unmetClauseCount` fields, computed in the receipt builder.
- `RuntimeTrace`: added immutable `authorityChanges`, sourced from the scenario turns executed by the runner.
- `ReplayFrame`: added frame-local `contractVersions`, `activeClauses`, and `authorityChanges`, plus `standardActionViews` and `mandateActionViews` using `ReplayActionStatus` (`pending`, `succeeded`, `blocked`, `unauthorized`).
- Live presentation components now accept those immutable frame/view-model fields rather than the final comparison or locally inferred status.

### Fix-round browser evidence

- The in-app browser binding reported no connected browser after the prescribed browser-control troubleshooting check. In accordance with the frontend testing fallback, local Playwright exercised `http://127.0.0.1:5173`; it did not browse an external site, deploy, submit, or perform a real action.
- At frame zero the browser found `Active authority · v0`, no v3 content, and `Replaying 0 of 23 milestones`. After Standard's unauthorized submit observation, the row was `event-warning`, not success.
- At 430 CSS px both tabpanel targets existed, exactly one was hidden, the compact current-authority summary showed `MAY Inspect next step` and `MUST NOT Submit application`, and a collapsed history target remained mounted with `hidden`.
- A generic `NO_CHANGE` scenario exposed one no-change notice and its real provenance. Original-size desktop and compact screenshots were compared with both approved concepts; the dedicated footer flow, truth-first v2/v3 history, and single compact authority/receipt/footer sequence remained intact. Temporary QA captures were removed after inspection because Task 8 owns final screenshot evidence.

### Fresh fix-round verification

All commands ran from the repository root on the fix-round working tree:

```text
npm test -- --run src/scenarios src/benchmark src/runtime src/evidence
  7 test files passed; 72 tests passed

npm test -- --run src/app src/components/live src/components/primitives && npm run typecheck && npm run lint && npm run build
  6 test files passed; 21 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

npm run verify
  21 test files passed; 174 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

git diff --check
git diff --cached --check
  both clean
```

The benchmark contract remains unchanged: Standard 5/15 exact with 8 unauthorized effects and 3 false claims; Mandate 15/15, 0, 0. No product or data-contract blocker emerged in this round.

## Fix round 2/5: visible action status and complete generic provenance

### RED evidence

- Extended the real `ComparisonPanel` presentation tests before production edits. The first focused run failed both action-status tests because `Pending observation` and `Action succeeded` were still rendered inside `.visually-hidden`; the blocked assertion also expected one visible canonical label rather than a hidden/visible duplicate pair.
- Added direct `MandateHistory` rendering tests with complete hand-authored `IntentDiff` values. The same RED run failed because REVOKE rendered only `− REVOKED · Deploy the preview to production.` and omitted `deploy-production-may`, while REPLACE rendered only `± MAY · Buy the item for Bob.` and omitted both target ids and the replacement id.
- RED command: `npm test -- --run src/components/live/ReplayPresentation.test.tsx src/components/live/MandateHistory.test.tsx` — 2 files failed, 4 tests failed for the intended missing presentation behavior.

### GREEN behavior

- Every action row now contains one visible `.action-status` node. Pending, succeeded, blocked, and unauthorized statuses remain engine-owned `ReplayActionStatus` values; React only maps the supplied value to text. Blocked uses its existing `BLOCKED by mandate vN` label once, avoiding duplicate announced text.
- Standard `submit_application` visibly renders `Unauthorized action observed`, remains `event-warning`, and contains no `Action succeeded` label after its unauthorized observation.
- Generic REVOKE now presents the engine tombstone id and statement: `− REVOKED · <id> · <statement>`.
- Generic REPLACE preserves every engine-supplied target id in source order and shows the replacement id, kind, and statement: `± REPLACE · <target ids> → <replacement id> · <kind> · <statement>`. No active state, source statement, or friendly authority is inferred.

### Fix-round visual QA

- The in-app browser runtime again reported no connected browser after its prescribed troubleshooting check, so local Playwright rendered the local-only app. No external site, deployment, submission, or real action was used.
- Compared fresh 1586×992 desktop and 430×1200 compact captures at original size with `design/concepts/live-desktop.png` and `design/concepts/live-mobile.png` in one inspection pass.
- Desktop comparison preserved the 88px header, 26/49/25 ruled rails, dedicated footer, local mono typography, semantic red/green/cobalt palette, and existing authority/receipt placement. The required 14px status line fits under each operation without adding a card, badge, pill, gradient, or new icon.
- Compact comparison preserved the v3 truth-first diff and current-authority summary, two mounted tabpanels with one hidden, single selected Standard trace, red unauthorized row, authority continuation, and normal document flow. The status text remained `display: block` at both widths.
- Above-the-fold copy changed only by making the already-defined action statuses visible. The critical Standard text is `Unauthorized action observed`; pending/success labels are `Pending observation` and `Action succeeded`; blocked remains `BLOCKED by mandate v3`. Temporary QA captures were removed after inspection because Task 8 owns final screenshot artifacts.

### Fresh fix-round verification

```text
npm test -- --run src/components/live/ReplayPresentation.test.tsx src/components/live/MandateHistory.test.tsx
  2 test files passed; 4 tests passed

npm test -- --run src/components/live src/components/primitives src/runtime/replay.test.ts src/app/useReplay.test.tsx && npm run typecheck && npm run lint
  7 test files passed; 25 tests passed
  typecheck clean; lint zero warnings

npm test -- --run src/scenarios src/benchmark src/runtime src/evidence
  7 test files passed; 72 tests passed

npm run verify
  22 test files passed; 176 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

git diff --check
git diff --cached --check
  both clean
```

The benchmark contract remains Standard 5/15 exact, 8 unauthorized effects, and 3 false claims versus Mandate 15/15, 0, and 0. No runner, policy, truth-first v2/v3 provenance, or external boundary changed.

## Fix round 3/5: distinguish revoked targets from tombstone metadata

### RED evidence

- Replaced the masking REVOKE fixture before production edits. The tombstone now mirrors compiler output with a new id (`turn-2:deploy-production-may:revoke`) distinct from two original target ids (`deploy-production-may`, `deploy-staging-may`).
- Added a schema-permitted empty-target case. `Clause.targetClauseIds` is optional and the current schema does not require a non-empty array, so the presentation must report unavailable targets rather than implying that the tombstone was the original grant.
- Focused RED: `MandateHistory.test.tsx` failed exactly two tests. Existing output was `− REVOKED · <tombstone id> · <statement>` in both cases, proving that every original target and the missing-target condition were omitted. The visible-status suite and existing REPLACE test remained green.

### GREEN behavior

- Generic REVOKE now separates the engine fields explicitly: `− REVOKE · targets: <all target ids> · tombstone: <new tombstone id> · <tombstone kind> · <tombstone statement>`.
- Target ids retain the deterministic engine-supplied order. The renderer does not sort, infer, or replace them with the tombstone id.
- When target ids are absent or empty, the same audit line states `targets unavailable` before the tombstone metadata. It does not fabricate an original grant or silently collapse the provenance distinction.
- The visible action statuses and generic REPLACE format from fix round 2 are unchanged. No runner, policy, benchmark, layout, truth-first v2/v3 provenance, or external boundary changed.

### Fresh fix-round verification

```text
npm test -- --run src/components/live/MandateHistory.test.tsx src/components/live/ReplayPresentation.test.tsx
  2 test files passed; 5 tests passed

npm test -- --run src/components/live/MandateHistory.test.tsx src/components/live/ReplayPresentation.test.tsx src/mandate/compiler.test.ts src/mandate/ledger.test.ts && npm run typecheck && npm run lint
  4 test files passed; 39 tests passed
  typecheck clean; lint zero warnings

npm test -- --run src/scenarios src/benchmark src/runtime src/evidence src/mandate
  11 test files passed; 138 tests passed

npm run verify
  22 test files passed; 177 tests passed
  typecheck clean; lint zero warnings; Vite build succeeded (148 modules)

git diff --check
git diff --cached --check
  both clean
```

The benchmark contract remains Standard 5/15 exact, 8 unauthorized effects, and 3 false claims versus Mandate 15/15, 0, and 0. No product or data-contract blocker emerged.

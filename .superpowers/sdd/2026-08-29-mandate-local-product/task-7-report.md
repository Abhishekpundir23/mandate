# Task 7 report — Computed Benchmark interface and case inspector

## Outcome

Implemented a controlled Live run / Benchmark product view backed by one immutable,
checksum-coherent Benchmark snapshot. The snapshot binds validated catalog fixtures,
the Benchmark report, exact paired comparisons/traces, paired scores, presentation
metrics, row statuses, decisive events, successful-observation evidence, and
reproducibility checksums. React renders the snapshot and performs no policy,
metric, PASS/FAIL, receipt, or evidence inference.

Headline results from the verified runtime:

- Exact mandate success: Standard 33%; Mandate 100%.
- Unauthorized effects: Standard 8; Mandate 0.
- False completion claims: Standard 3; Mandate 0.
- Seed checksum: `2bad36dc`; catalog: `af5f546f`; proposals: `1ef5880f`;
  traces: `1c48b617` (display prefixes from the complete report checksums).

## RED evidence

### Initial adapter, UI, and controller RED

Command:

`npm test -- --run src/benchmark/snapshot.test.ts src/components/benchmark/BenchmarkView.test.tsx src/app/App.test.tsx`

Observed expected failures:

- `snapshot.test.ts` and `BenchmarkView.test.tsx` failed import resolution because
  `src/benchmark/snapshot.ts` and the Benchmark components did not exist.
- Two App controller tests failed because no reachable Benchmark navigation existed.
- Summary: 3 failed test files; 2 failed and 1 passed executable tests.

### Evidence-selection RED

Command:

`npm test -- --run src/benchmark/snapshot.test.ts -t "binds every catalog case"`

Observed expected failure: the initial adapter exposed every successful observation
fact (`fieldsFilled`, `nextStepObserved`, and `uploads`) instead of the declared,
observation-backed flagship evidence keys `draftSaved` and `submitted`.

### Truthful safe-trace and operational-label RED

Command:

`npm test -- --run src/benchmark/snapshot.test.ts src/components/benchmark/BenchmarkView.test.tsx`

Observed two expected UI failures: safe paired cases still said `Violation trace`,
and the flagship fact key rendered as `draftSaved` instead of deterministic
operational `draft_saved`.

### Safe-lane semantic-color RED

Command:

`npm test -- --run src/components/benchmark/BenchmarkView.test.tsx -t "labels safe paired outcomes"`

Observed expected failure: the safe Standard lane had the old lane-owned red class
instead of the score-owned `event-pass` class.

## GREEN evidence

### Focused Task 7 + Live regression

Command:

`npm test -- --run src/benchmark/snapshot.test.ts src/components/benchmark/BenchmarkView.test.tsx src/app/App.test.tsx src/components/live/LiveRunView.test.tsx`

Result: 4 files passed; 29 tests passed.

This covers coherent/deep-frozen snapshots, complete score re-evaluation against
each trace, all 15 rows, score-owned statuses, mutated 40% presentation input,
stable sort and header focus, selection persistence, inspector changes/provenance,
direct-only mobile scrolling, rerun checksum stability, navigation, and Live behavior.

### Benchmark/runtime/evidence regression

Command:

`npm test -- --run src/benchmark src/runtime src/evidence`

Result: 6 files passed; 62 tests passed.

### Complete quality gate

Command: `npm run verify`

Result:

- TypeScript project build: passed.
- ESLint with zero warnings: passed.
- Vitest: 24 files passed; 195 tests passed.
- Vite production build: passed; 160 modules transformed.
- `git diff --check`: passed before staging.

## Browser fidelity evidence

Method: Codex in-app Browser against local Vite at `127.0.0.1`, followed by an
exact-size screenshot saved temporarily for the required original-detail
`view_image` comparison. The temporary QA screenshot was removed after review.

Viewports checked:

- Approved native desktop: 1586×992.
- Compact mobile: 390×844.

Interaction evidence:

- Sorting Standard set the owning `<th aria-sort="ascending">` and retained focus
  on the native header button.
- Selecting Preview changed the inspector to `release.deployProduction`, proposal
  `preview-is-not-deploy:unsafe`, and `deploy_production_release`.
- Run benchmark recomputed the complete snapshot and announced
  `Benchmark recomputed · trace 1c48b617` without changing deterministic truth.
- Mobile Live run / Benchmark navigation remained visible and operable.
- Direct mobile row activation smoothly settled the selected inspector at the
  viewport start; prop/state changes do not trigger that scroll path.

Fidelity ledger:

| Checkpoint | Approved concept | Final render | Resolution |
|---|---|---|---|
| Header geometry | ~80px, quiet nav, right controls | 80px; matching hierarchy | Matched; Benchmark controls scoped to 48px without changing Live's 88px shell. |
| Metric band | 144px ruled open band | 144px, four ruled groups | Matched; all values come from snapshot metrics. |
| Main split | ~69/31 with vertical rule | 70/30 with uninterrupted rule | Matched. |
| Main/footer geometry | 706px / 62px | 706px / 62px | Matched. |
| Typography | Local IBM Plex Mono / Roboto Condensed | Same local packages; metadata >=16px | Matched. |
| Palette/treatment | True near-white, cobalt, red, green; no cards/shadows | Same tokens; no gradients, pills, shadows, or floating inspector | Matched. |
| Status language | 2px SVG plus PASS/FAIL | 2px check/cross SVG plus visible label/color | Matched. |
| Inspector | Turns, decisive trace, evidence, boundary | Actual full turns, trace capability/proposal provenance, evidence IDs, score evaluation | Truthfully strengthened. |
| Responsive | Ruled stack; inspector after scrollable table | Ruled stack at 390px; semantic horizontal-scroll table; direct-only inspector scroll | Matched. |
| Footer | Local boundary + reproducibility | Local boundary + computed seed/catalog/proposal/trace checksums | Replaced illustrative `seed 42` with runtime truth as required. |

Above-the-fold copy diff: no unapproved marketing or decorative copy was added.
The locked MANDATE, Live run, Benchmark, deterministic scenario count, Run
benchmark, metric headings, and computed-results subtitle are present.

Intentional truth-first differences from the illustrative concept:

- Rows are at least 44px and therefore scroll inside the fixed 706px main region;
  all 15 remain semantic and reachable instead of shrinking to the concept's
  placeholder row density.
- Actual full turn text, raw operational failure categories, capability/proposal
  provenance, and evidence IDs replace shortened illustrative labels.
- Runtime checksums replace the concept's numeric seed literal.

The accepted concept and final native-size render were inspected together at
original detail. No fixable material visual mismatch remains within the locked
runtime-truth and 44px-accessibility constraints.

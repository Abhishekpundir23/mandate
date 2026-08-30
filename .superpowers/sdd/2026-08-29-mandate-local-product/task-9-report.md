# Task 9 closed-world capability/effect report

Date: 2026-08-30

Plan/base commit: `7eefaee` (source-equivalent architecture base `ae43163`)

Implementation commit: `4d030474f3d90329270fed24e398964e4bf31cf6`

Branch: `feat/mandate-local-product`

Scope remained local. No deploy, push, publish, upload, registration, submission, or external-system operation occurred.

## Outcome

Task 9 replaces the split Task 8 syntax-specific checks with one closed-world production analyzer:

```text
TypeScript Program
  -> uniform binding/write/call IR
  -> conservative origin and interprocedural call fixed point
  -> exact per-module host-effect budget
```

All 51 prior production modules plus the new browser facade pass without file, function, line, or source-location exceptions. Unsupported calls/effects fail closed. The final production report contains zero network, storage, navigation, form-submit, unsafe-DOM, dynamic-code, and unknown effects.

## What changed

- `security-assignment-analysis.mjs` now lowers identifier/member leaves through one path for declarations, parameters, catch bindings, object/array binding patterns, object/array destructuring assignments, static/computed/nested/default/rest projections, direct/compound writes, update/delete, and `for...of`/`for...in` targets. Member-expression pattern leaves become the same `WRITE(receiver,key,value)` operation as direct assignments.
- `security-type-analysis.mjs` implements monotone origins for constants, fresh owned allocations, borrowed data, ambient authority, opaque capabilities, summarized callables, React UI cells, Zod schemas, and unknown values. Casts, aliases, generic/indexed types, containers, closures, returns, arguments, loops, and reassignment preserve or conservatively join provenance.
- `security-call-summaries.mjs` centrally declares standard-library, Object/Reflect mutation, Array/Map/Set/WeakMap/WeakSet mutator, React, Zod, browser-facade, constructor, higher-order callback, and forbidden capability semantics. Unknown callees, callbacks, constructors, optional/meta calls, or tags emit `HOST_UNKNOWN`.
- `security-source-scan.mjs` applies the IR/origin result once, verifies owned/UI-cell mutation receivers, finite safe prototype-bearing keys, getter-free `Object.assign` sources, data-only descriptors, safe `Object.create(null)`, imports/JSX/endpoints, and exact effect budgets. Diagnostics are sorted by path/line/column/code and include provenance routes.
- `security-source-policy.mjs` has declarative budgets instead of reflection/source-location exceptions.
- `src/platform/browser-capabilities.tsx` owns all browser ambient access and exports only hard-coded `#root` mounting, three approved media queries without returning `MediaQueryList`, a fixed 180 ms replay timer, and opaque accessible focus/compact-scroll hooks.
- `main.tsx`, `useReplay.ts`, `ComparisonPanel.tsx`, `BenchmarkView.tsx`, and `AccessibleTabs.tsx` consume the narrow facade. Product output and interaction behavior are unchanged.
- CSP, fresh-build enforcement, built-asset scanning, and browser request/runtime interception remain independent layers.

## Genuine RED/GREEN evidence

All new behavior began with tests against the Task 8 implementation.

### Initial Task 8 false-green RED

Focused command:

```text
npm test -- --run scripts/security-gate.test.ts -t "closes Task 8 false green"
```

Result before implementation: 7 failed, 1 passed, 110 skipped. The old gate incorrectly accepted object- and array-destructuring member targets, `for...of` receiver laundering, a reassigned local factory, direct `Object.assign` onto borrowed DOM, an `Object.assign` alias, and a reassigned alias. Its nested/default member-target branch already rejected one case.

Broad Task 9 RED:

```text
npm test -- --run scripts/security-gate.test.ts -t "closed-world origin and effect gate"
```

Result before implementation: 21 failed, 22 passed, 75 skipped. False-greens included computed delete, borrowed Array/Map/Set mutators, Object/Reflect descriptor mutations, closure/argument/conditional/container laundering, unknown call/constructor/tag effects, and raw ambient access outside a facade. False-reds included harmless local `innerHTML`, local data descriptors/Reflect writes, safe nested/member patterns, and a null-prototype dictionary.

Facade RED: the new four-test facade suite failed to resolve the missing module before `browser-capabilities.tsx` was authored. It is 4/4 green after implementation.

Post-GREEN bypass audit RED: four additional source-level attacks still passed the first architecture-green revision—an unresolved higher-order callback, an ambient `Object.create` prototype, an aliased accessor descriptor, and a DOM-value write through a React ref. Those four were added before their fixes, reproduced RED together, and now pass with paired analyzed-callback and UI-cell-assignment positives.

Final structural suite: 124/124 green. Its exact composition is:

| Corpus | Negative | Positive | Behavioral |
| --- | ---: | ---: | ---: |
| Retained Task 8 structural corpus | 59 | 15 | 1 stale-build replacement test |
| Task 9 hostile × safe matrix | 28 (8 exact false-greens + 20 extended) | 17 | 0 |
| Task 9 facade/provenance/report boundaries | 2 | 2 | 0 |
| Total | 89 | 34 | 1 |

## Deterministic host-effect report

Exact final totals over 52 production TS/TSX files:

| Effect | Count |
| --- | ---: |
| `HOST_LOCAL_MUTATION` | 57 |
| `HOST_UI_STATE` | 18 |
| `HOST_TIMER` | 2 |
| `HOST_VIEWPORT_READ` | 6 |
| `HOST_DOM_MOUNT` | 3 |
| `HOST_DOM_FOCUS` | 1 |
| `HOST_DOM_SCROLL` | 1 |
| `HOST_NETWORK` | 0 |
| `HOST_STORAGE` | 0 |
| `HOST_NAVIGATION` | 0 |
| `HOST_FORM_SUBMIT` | 0 |
| `HOST_UNSAFE_DOM_WRITE` | 0 |
| `HOST_DYNAMIC_CODE` | 0 |
| `HOST_UNKNOWN` | 0 |

`forbidden=0; unknown=0`.

Application modules have only `{HOST_LOCAL_MUTATION, HOST_UI_STATE}` in budget. `src/platform/browser-capabilities.tsx` additionally has `{HOST_TIMER, HOST_VIEWPORT_READ, HOST_DOM_MOUNT, HOST_DOM_FOCUS, HOST_DOM_SCROLL}`. Search confirms raw `window`/`document` production references occur only in that facade. The facade itself reports mount 3, viewport 6, timer 2, focus 1, scroll 1, local mutation 2, and UI state 2; no raw host object is returned.

## Fresh full verification

Fresh command after the source implementation and architecture/Task 8 claim updates:

```text
npm run verify
```

| Stage | Result |
| --- | --- |
| Typecheck | `tsc -b --pretty false`, exit 0 |
| Lint | `eslint . --max-warnings 0`, zero warnings/errors |
| Unit/security/component | 28 files, 420 passed, 0 failed |
| Global coverage | Statements 96.12% (1537/1599); branches 91.58% (1285/1403); functions 98.65% (439/445); lines 97.30% (1408/1447) |
| Build | Vite 8.2.2; 162 modules; 1 HTML, 3 JS, 1 CSS, 12 WOFF, 12 WOFF2 |
| E2E | 18 scheduled across desktop/mobile; 13 passed; 5 intentional project-specific skips; 0 failed |
| Source effects | 52 production modules; forbidden 0; unknown 0 |
| Built security | Strict local CSP/assets; zero built network primitives |

The host emitted its existing Playwright `NO_COLOR`/`FORCE_COLOR` warning. The product tour independently asserts zero application console warnings/errors, page errors, unexpected external requests, or runtime capability violations.

The standalone security command also passed from an absent `dist`: `npm run test:security` rebuilt 162 modules and then passed source/effect and built-asset gates. The automated stale-`dist` replacement regression remains green.

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

All three hashes exactly match the approved Task 8 screenshots. Desktop benchmark geometry still has all 15 rows fully visible, `scrollTop=0`, and zero horizontal overflow. The mobile keyboard path and compact scroll behavior remain covered.

## Post-GREEN source-level audit

The final audit checked every normalized write/call channel, aliases of Object/Reflect mutations, `.call`/`.apply`/`.bind`, optional calls, callbacks, constructors/tags, prototype creation, React ref wrapper-versus-value provenance, raw ambient search, and source-location exception search. The four bypasses found during that audit became RED tests before their fixes. Final checks:

- raw ambient production access is confined to the facade;
- no `safeReflectionSites` or file/function/line exception remains;
- `git diff --check` passes;
- implementation and documentation are committed separately;
- final worktree is clean.

## Bounded guarantee and residual risk

This is a closed-world guarantee over the production TypeScript subset understood by the IR and declared summaries. It intentionally does not claim to prove arbitrary JavaScript, third-party package internals, browser correctness, or the TypeScript compiler itself. A new unsupported syntax, unresolved callable/effect, unapproved import, raw host capability, or unknown mutation origin fails closed until its semantics and tests are added. The residual analyzer/summary risk is bounded by independent strict CSP, fresh-build enforcement, built-asset scanning, zero-network bundle rules, and desktop/mobile runtime interception.

No external action was performed and no challenge submission was made.

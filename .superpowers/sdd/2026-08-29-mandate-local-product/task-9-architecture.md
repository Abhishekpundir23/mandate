# Task 9 implemented security architecture

Implemented by review-fix commit `e51e377d958b2fa0455237a73f5885afe3b1ba6e`.

Replace the patch-by-patch scanner with one closed-world capability/effect gate. Keep CSP, built-asset scanning, and browser interception as independent defenses.

## Root cause

The pre-Task 9 scanner made decisions in separate syntax-specific branches. Reassignment analysis missed loop/callback/API writes; pattern recursion could miss member-expression leaves; nested source provenance was lost; spelling-based sink rules confused harmless local fields with authority; and semantically equivalent writes such as `Object.assign`, descriptors, and direct assignment were handled separately. The implemented policy reasons about receiver origin and operation effect, not syntax spelling.

## Pipeline

```text
TypeScript Program
    -> uniform binding/write/call IR
    -> origin + effect fixed point
    -> module effect-budget check
```

The analyzer supports a bounded production subset. Unsupported or unresolved capability use fails closed. It must not claim to prove arbitrary JavaScript.

## Review-fix implementation addendum

- Inventory begins at the JavaScript entry in `index.html` and closes every reachable local runtime import. Test exclusions apply only after reachability is disproved; reachable test-scoped paths and unsupported JS/JSX/other extensions reject. Every reachable TS/TSX module requires an analysis receipt.
- Vite receipt schema v3 binds the source graph to Rollup's module graph and exact emitted JavaScript chunk set. The built scanner requires exact set equality, so copied or otherwise unreceipted JS fails even when module counts appear unchanged.
- Ambient and opaque origins survive every projection. Emitless host-interface declarations are ambient; reflection results remain opaque; call/apply/bind require a directly analyzed callable set; unsupported strict-TypeScript semantics emit sorted `HOST_UNKNOWN` diagnostics.
- Loop elements, spreads, flat/concat/map results, collection contents, callbacks, JSX/ref edges, defaults, conditional/coalescing joins, closures, returns, and escapes are value-transfer edges in the same origin analysis.
- Facade exports are checked recursively through aliases, nested/default returns, callable/class fields, and closures. Receiver contracts are exact and direct: overloads, aliases, extra members, index/construct signatures, and widened generic relations do not inherit authority.
- HTML `template` is forbidden to close declarative-shadow-DOM markup, while CSP, fresh-build enforcement, built scanning, and runtime interception remain separate controls.

## Uniform write IR

Normalize through one path:

- variable declarations and parameter bindings;
- object/array binding declarations;
- object/array destructuring assignments;
- static, computed, nested, default, and rest patterns;
- direct and compound binary assignments;
- prefix/postfix updates and delete;
- `for...of` and `for...in` initializers;
- catch bindings;
- property and element writes;
- `Object.assign`, `Object.defineProperty`, `Object.defineProperties`;
- `Reflect.set`, `Reflect.defineProperty`, `Reflect.deleteProperty`;
- Array, Map, Set, WeakMap, and WeakSet mutators;
- React ref writes;
- calls that mutate a parameter or receiver.

Pattern projections must lower into ordinary dataflow edges. If a pattern target is a member expression, lower it to the same `Write(receiver,key,value)` operation as direct assignment. No assignment-pattern-specific security decision remains.

## Conservative origin lattice

Track sets of origins and join monotonically:

- `Constant(value)` — inert primitive or finite compile-time key;
- `Owned(allocationIds, shape)` — locally created unescaped object, array, Map, Set, WeakMap, or WeakSet;
- `BorrowedData` — parameter/imported/untrusted data, readable but not writable;
- `Ambient(kind)` — DOM, window, navigation, storage, network, dynamic code, or host authority;
- `OpaqueCapability(kind)` — deliberately exposed high-level platform handle;
- `Callable(summaryIds)` — only analyzed/declaratively summarized functions;
- `Unknown` — fail closed at an effect boundary.

Rules:

- casts, non-null assertions, `satisfies`, aliases, generics, and type assertions never change origin;
- `Owned` survives a join only when every possibility is owned and unescaped; mixing owned with DOM becomes `Unknown`;
- fields retain shape provenance so safe nested local data can stay owned;
- closures carry captured origins;
- returns, arguments, destructuring, loop assignments, and container elements propagate through one graph;
- parameters begin as `BorrowedData`; summaries may require owned arguments for mutation;
- passing owned state to unknown calls, storing it into ambient/borrowed state, or returning it through an unresolved boundary marks it escaped.

Track keys separately as finite strings, numeric index, or unknown. Prototype-bearing object writes require a finite safe key excluding `__proto__`; unknown string keys are allowed only for an owned null-prototype dictionary or Map. Constant evaluation covers literals, templates, concatenation, literal unions, and pure literal operations such as `'label'.slice(0)`.

## Call and effect summaries

Every call, optional call, constructor, tagged template, `.call`, `.apply`, or `.bind` resolves to:

- an analyzed local-function summary;
- a declarative standard-library/framework summary; or
- an explicitly approved platform capability.

Otherwise emit `HOST_UNKNOWN` and fail.

Host effects:

- `HOST_LOCAL_MUTATION`
- `HOST_UI_STATE`
- `HOST_TIMER`
- `HOST_VIEWPORT_READ`
- `HOST_DOM_MOUNT`
- `HOST_DOM_FOCUS`
- `HOST_DOM_SCROLL`
- `HOST_NETWORK`
- `HOST_STORAGE`
- `HOST_NAVIGATION`
- `HOST_FORM_SUBMIT`
- `HOST_UNSAFE_DOM_WRITE`
- `HOST_DYNAMIC_CODE`
- `HOST_UNKNOWN`

Semantic examples:

- `Object.assign(target,...sources)` emits writes to target and is allowed only for owned target and inert/getter-free sources;
- `Object.getPrototypeOf` returns an opaque prototype token usable only for identity comparison;
- descriptor maps may expose data for inspection, but getters/setters cannot be invoked;
- collection mutators require owned receivers;
- iteration analyzes callback summaries with borrowed element origins;
- React/Zod callbacks inherit analyzed callback effects;
- JSX handlers are analyzed even if not synchronously called;
- dynamic access to a local table of known pure functions may return the union of those summaries;
- a function obtained from DOM, reflection, `any`, or untrusted data is not callable merely because a cast gives it a callable type.

## Browser capability boundary

Move raw ambient use behind `src/platform/browser-capabilities.tsx` (or an equivalently small facade) that exports only:

- mount the React app into hard-coded `#root`;
- read/subscribe to approved media queries without returning raw `MediaQueryList`;
- schedule/cancel replay timers;
- opaque accessible focus/scroll operations.

The facade receives only mount, media read/subscription, timer, focus, and scroll effects. It cannot expose raw DOM objects or generic property/call access. All other modules get no ambient budget. Network, storage, navigation, form submission, unsafe DOM mutation, dynamic code, and unknown effects are forbidden everywhere.

## File plan

- `security-source-scan.mjs`: keep import-graph/JSX structural collection, but build unified IR, solve summaries, and emit sorted provenance diagnostics.
- `security-type-analysis.mjs`: replace immediate local-data/reassignment/callable heuristics with origin graph and interprocedural fixed point. TypeScript supplies symbol identity/declarations/literal unions/source mapping; casts never grant authority.
- `security-assignment-analysis.mjs`: become a write/binding normalizer returning leaf writes and source projections.
- `security-source-policy.mjs`: declarative module budgets, external/standard/framework summaries, and browser facade contract. Remove source-location exceptions.
- new `security-call-summaries.mjs`: Object/Array/Map/Set/React/Zod/platform summaries.
- `security-gate.test.ts`: exercise analyzer in memory, retaining one command/build-freshness test.
- production: refactor ambient use now concentrated in `main.tsx`, `useReplay.ts`, `ComparisonPanel.tsx`, and `BenchmarkView.tsx`; focus/scroll may also touch `AccessibleTabs.tsx` and `ScenarioInspector.tsx`.
- docs: state bounded source subset and residual risk exactly.

Migration result: the 51 Task 8 production TS/TSX modules plus the browser facade make 52 analyzed modules. The HTML entry graph proves 49 runtime-reachable source modules; Vite/Rollup independently receipts the same 49 and exactly three JavaScript chunks. Raw `window`/`document` production access is confined to the facade. The final report has zero forbidden or unknown effects.

## Acceptance criteria

1. Latest hostile programs all fail: object/array destructuring member writes, `for...of` DOM laundering, reassigned factory, and `Object.assign`/alias onto DOM.
2. Paired safe programs pass: safe nested-rest, finite computed local data write, nested owned object write, and local `Object.assign` with inert sources/keys.
3. Metamorphic dangerous/safe receiver matrix covers direct, compound, update, delete, object/array pattern, nested/default/rest, loop assignment, assign/descriptor APIs, and mutators.
4. Alias, closure, return, argument, generic, conditional, container, loop, and cast laundering cannot turn ambient into owned.
5. Unknown callees, callbacks, constructors, imports, computed ambient members, or unsupported syntax fail deterministically.
6. All 51 prior production modules plus the facade (52 current modules) pass without file/function/source-location reflection exceptions; all 49 entry-reachable sources and three built JS chunks have exact receipts.
7. Effect report contains exactly approved UI/platform effects and zero network, storage, navigation, form, unsafe-DOM, dynamic-code, or unknown effects.
8. Diagnostics include full provenance routes.
9. Standalone source security, fresh-build check, built-assets, CSP, runtime interception, and full `npm run verify` remain green.
10. Docs state this is a closed-world production subset plus layered runtime controls, not proof over arbitrary programs.

The key policy is that a property name such as `innerHTML` on local data is not itself authority. The write is dangerous because its receiver is DOM/ambient or unproven. Make that distinction once, centrally.

## Accepted bounded guarantee and trusted computing base

All ten acceptance criteria are green at `e51e377`: the frozen independent matrix is 47 hostile rejected and 20 safe accepted; the expanded structural suite is 324/324; the production effect report has 52 analysis, 49 runtime, and 49 bundle receipts with zero network, storage, navigation, form, unsafe-DOM, dynamic-code, or unknown effects.

The guarantee covers the current HTML-reachable graph and analyzer-supported strict TS/TSX subset, not arbitrary JavaScript. The trusted computing base is TypeScript's parser/checker, the inventory/normalizer/origin/effect implementation and explicit summaries/budgets, Node filesystem/path canonicalization, the HTML graph parser, and Vite/Rollup's module/output graph. Third-party implementation semantics and browser correctness are outside the static proof; exact built receipts, CSP, asset scanning, and desktop/mobile runtime interception independently bound that residual risk.

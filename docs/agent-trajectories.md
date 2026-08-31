# Coding-agent disclosure and representative trajectories

MANDATE was built with Codex as the coding-agent environment. The agents worked on the repository, ran local development tools, and returned patches or review findings to one primary controller. No coding agent is embedded in the shipped product, and the application does not call a model or provider API at runtime. Exact model-version identifiers and private system prompts are not stored in this repository, so this document does not invent them. The entries below are faithful, condensed trajectories reconstructed from the plan, task reports, tests, and Git history; they are not fabricated chat transcripts.

## What existed before this build

No earlier MANDATE implementation appears in this repository history. The root commit, `31ec577` on 2026-08-29, introduced the product specification, implementation plan, ignore rules, and three concept images; subsequent commits contain the implementation and verification history. Pre-existing inputs were the general-purpose Codex tooling and the open-source development packages pinned in `package-lock.json`. React, TypeScript, Vite, Vitest, Playwright, Zod, axe, ESLint, the two local font packages, Lucide, and their transitive packages remain governed by their respective package licences. The repository does not declare a separate public project licence and is being supplied as competition source, not represented as a newly relicensed distribution of those dependencies.

## Agent roles and controls

| Role | Authority and output | Human/controller control |
| --- | --- | --- |
| Primary Codex controller and implementer | Translated the approved idea into the specification and task plan; edited source and documentation; ran Git, Node, tests, builds, and local inspection; integrated delegated work. | The human approved the product direction, requested best-in-class quality, required a private repository, and retained control over deployment and competition submission. |
| Delegated product and implementation agents | Implemented bounded plan tasks such as the Live comparison, benchmark snapshot/UI, fixtures, tests, and security mechanisms; returned code plus RED/GREEN evidence. | The controller supplied a narrow objective and acceptance criteria, reviewed returned diffs/reports, requested fix rounds, and committed accepted work. |
| Delegated code, accessibility, and security reviewers | Tried to falsify the implementation with independent review cases, source inspection, accessibility scans, and focused verification; returned findings rather than silently accepting green checks. | The controller converted findings into regression tests, revised the implementation, and requested re-review. Claims were narrowed where a general proof was not supported. |
| Browser and verification reviewers | Operated only the local build in an in-app browser, Safari, or local Playwright; checked interactions, rendered geometry, accessibility, console/runtime behavior, offline egress, and screenshot fidelity. | They were not authorized to deploy, publish, upload, or submit. The human supplied the final usability feedback about the benchmark control. |
| Documentation, claim-audit, and repository-safety reviewers | Compared README/demo wording with runtime evidence, checked private-repository hygiene, and reviewed the recording flow. | Unsupported wording was corrected before submission packaging; secrets and local credentials remained ignored. |

## Representative trajectory 1 — controller from idea to an executable contract

**Instruction/objective.** Build a non-basic creativity-hackathon product that demonstrates a consequential problem for tool-using agents, while keeping all effects local and leaving external submission under human control.

**Key tool actions and responses.** The controller turned the thesis “version control for authority” into `docs/specs/2026-08-29-mandate-product-spec.md` and the task plan in `docs/superpowers/plans/2026-08-29-mandate-local-product.md`. It used repository inspection, patch application, Git, TypeScript/Vitest, and local rendering to build the domain model, immutable ledger, gate, confirmation lifecycle, sandbox capabilities, evidence receipts, 15-case catalog, paired evaluator, and React UI. The commit sequence records the progression from domain foundation (`b905225`) through authority/versioning (`36836e6`), gating (`5e6dd55`), paired execution (`fe7560a`), benchmark (`bdf5f1a`), and complete product verification (`fd8f7b7`).

**Feedback.** Tests and delegated reviews showed that an attractive demonstration was insufficient: scenario provenance, confirmation issuance, trace causality, evidence timing, accessibility, and host-capability boundaries all had to be executable and independently checked.

**Retry/revision.** The controller preserved failures as regression tests, then iterated through focused fixes such as `a6368c1`, `43bf32a`, `d55a475`, `aa02254`, `70de741`, and `a2ec2f5`. It also revised documentation when product evidence did not justify broader language, notably `f78f7c6` and `723088a`.

**Human checkpoint/outcome.** The human approved continued implementation and asked for the strongest complete local product, but initially prohibited final submission. The outcome was a private, reproducible local application whose real external actions remain impossible by design; the later competition-form workflow remained a separate human-controlled step.

## Representative trajectory 2 — delegated Live and benchmark implementation

**Instruction/objective.** Implement the approved Live comparison and the computed Benchmark without allowing React to invent policy, scores, evidence, or outcomes.

**Key tool actions and responses.** Delegated implementers followed the scoped plan and used test-first changes. For the Live surface, missing-module tests failed before `useReplay`, accessible tabs, and `LiveRunView` existed; later tests exposed future-state leakage, incorrect authority ordering, and fixture-story mismatches. For the Benchmark, tests first failed because the immutable snapshot and reachable navigation did not exist, then exposed excess evidence selection and misleading “Violation trace” language for safe cases. The concrete evidence is retained in `.superpowers/sdd/2026-08-29-mandate-local-product/task-6-report.md` and `task-7-report.md`.

**Feedback.** Controller review required runtime-owned replay status, frame-local authority, actual generic provenance, one accessible selected tabpanel, source-computed benchmark metrics, coherent checksums, and truthful safe-lane labels. An accessibility review additionally found 39 serious desktop and 11 serious compact contrast nodes, plus a keyboard-focus issue in a scrollable inspector.

**Retry/revision.** The agents added failing regressions, revised the data/view-model boundary, repaired replay and provenance presentation across multiple fix rounds, replaced status-text colors without changing decorative concept colors, and made the inspector keyboard-focusable. Focused suites, complete `npm run verify`, axe, and local browser checks were rerun after the revisions. The accepted feature commits include `2c44340`, `68fda5f`, `5a98a35`, `eb40aa3`, `d7577ef`, and `4048c7e`.

**Human checkpoint/outcome.** The controller accepted the work only after the reports showed genuine RED then GREEN evidence and browser fidelity at the required desktop/mobile viewports. The human could then run the same comparison and benchmark locally rather than relying on a mocked video or static claim.

## Representative trajectory 3 — independent security review and three repair rounds

**Instruction/objective.** Attempt to break the claim that the production build has no unintended host capability or egress, and distinguish a bounded, supported-program guarantee from an unjustified proof over arbitrary JavaScript.

**Key tool actions and responses.** Review agents inspected the source analyzer and ran independent strict-TypeScript programs. On the first reviewed base, 23 hostile programs were accepted and 10 safe programs were rejected. Further rounds reproduced an unproven fourth-receiver path through `Reflect.set`, deferred callbacks whose later-widened captures were missed, conditional-spread/enumerability errors, sparse argument compaction, and descriptor-order defects. Those exact RED/GREEN matrices are retained in `.superpowers/sdd/2026-08-29-mandate-local-product/task-9-report.md` and the implemented mechanism is documented in `task-9-architecture.md`.

**Feedback.** The reviewers rejected the earlier syntax-specific policy and asked for receiver-origin/effect reasoning, a closed runtime inventory, exact source/bundle receipts, semantic call summaries, conservative interprocedural propagation, deferred-callback replay, and fail-closed unsupported behavior. They also required honest scoping of the trusted computing base and residual risk.

**Retry/revision.** The implementation was rebuilt as a uniform binding/write/call analysis with a narrow browser facade. Review round 1 landed in `e51e377`, round 2 in `670e5de`, and round 3 in `d813838` with mechanism commits including `f820554` and `b28ef0d`. Each round first froze the supplied reproductions, then reran both hostile and paired-safe controls. Final retained evidence is 508/508 checked-in structural cases, an unchanged independent matrix of 47 hostile rejections and 20 safe acceptances, 52/52 enumerability checks, 92/92 ordered-convergence checks, and zero reported network, storage, navigation, form-submit, unsafe-DOM, dynamic-code, or unknown production effects.

**Human checkpoint/outcome.** The controller accepted a closed-world guarantee over the current HTML-reachable strict TS/TSX subset, not a universal security proof. The human-facing product and README preserve that bounded claim, and no reviewer was given authority to contact an external service.

## Representative trajectory 4 — browser review of the apparently inactive benchmark button

**Instruction/objective.** Reproduce the human report that **Run benchmark** appeared unclickable or inactive, determine whether execution or feedback was broken, and fix it without changing benchmark truth.

**Key tool actions and responses.** The controller and a delegated verification reviewer inspected the running local product in Safari and exercised the button with browser automation. The accessibility tree showed an active button and a recomputed trace, while CSS inspection showed that `.benchmark-progress` visually clipped the status to a 1-by-1-pixel region. Because the benchmark is deterministic, the unchanged metrics and checksums provided no other visible indication that the click had run.

**Feedback.** The reviewer asked for visible initial state and monotonically clear per-click feedback while retaining checksum stability. Regression tests were written first: the component test expected `Benchmark ready`, then run 1 and run 2 completion; the real-browser test required a visible status box and the same trace checksum after both runs. Both tests failed against the old UI for the intended reasons.

**Retry/revision.** Commit `65d53e8` moved the live status into the header, exposed it visually with a polite live region, incremented a local run counter, and updated the demo script. Focused unit tests, typecheck, zero-warning lint, production build, 14 passing browser journeys with six intentional project-specific skips, actual Safari interaction, and an independent desktop/mobile recheck all passed. On desktop the reviewer measured the ready status as visible; on compact layout the trace tail may ellipsize visually while the full status remains accessible.

**Human checkpoint/outcome.** The human initiated this trajectory by reporting the usability failure and approved the repair. The final local UI now changes from `Benchmark ready` to `Benchmark run 1 complete` and `Benchmark run 2 complete` without changing the deterministic trace checksum.

## Representative trajectory 5 — claim audit, recording, and repository safety

**Instruction/objective.** Make the demonstration compelling but ensure every spoken/written claim matches observable product evidence, keep the repository private, and prepare rather than silently perform external submission.

**Key tool actions and responses.** Documentation agents compared the README, benchmark methodology, architecture, fidelity ledger, and recording script with source-computed outputs. A claim-audit pass revised the primary recording script in `723088a`; the benchmark-feedback repair updated its click cue in `65d53e8`. Repository-safety review added local credential patterns to `.gitignore` in `0e15abc` and checked that the private Git remote matched the local verified head. The source contains no provider keys or personal fixture data.

**Feedback.** Review flagged language that could imply a universal agent baseline, real-world execution, cryptographic/tamper-proof checksums, or a security proof beyond the analyzed subset. The human also required a click-and-speak script for the recorded demo and asked that the work remain safe in a private repository.

**Retry/revision.** Wording was narrowed to “ungated fixture control,” checksums were described as reproducibility checks rather than security hashes, runtime boundaries were made explicit, and each video cue was linked to a visible result. Generated archives and form entry were treated as preparation steps, not proof of submission.

**Human checkpoint/outcome.** The human recorded the demo and retained the final decision over the competition form. The resulting package can disclose how agents helped build and review MANDATE without including private orchestration prompts, credentials, local paths, or invented transcript content.

## Tool, data, licence, and privacy boundary

- **Coding tools:** Codex orchestration, local shell commands, patch application, Git, Node/npm, TypeScript, ESLint, Vitest, Vite, Playwright, axe, local browser inspection, and image inspection were used during development and review.
- **Runtime data:** all 15 scenarios, proposal streams, worlds, observations, and receipts are deterministic synthetic fixtures committed in `src/scenarios`; there is no training, scraping, user profiling, or hidden evaluation dataset.
- **Runtime connectivity:** MANDATE uses no model API, credentials, telemetry, analytics, persistence, real integration, or product network endpoint. Its capabilities mutate only an in-memory world. Browser interception and the built/source gates independently enforce the local-only boundary.
- **Agent access:** coding agents received the project files and task conversation needed to implement and review the product. No private prompt transcript, secret, authentication token, or personal fixture data is included in the source package. Local paths are intentionally omitted from this disclosure.
- **Third-party code:** package names and exact versions are declared in `package.json` and locked in `package-lock.json`; their own licence terms apply. No claim is made that agent assistance changes third-party ownership or licence obligations.
- **Human responsibility:** agents proposed, implemented, tested, and reviewed. The human selected the idea, set safety and privacy boundaries, requested revisions, recorded the demo, and controls the final upload/submission decision.

## Evidence index

- Product intent and architecture: `docs/specs/2026-08-29-mandate-product-spec.md`, `docs/architecture.md`
- Implementation plan: `docs/superpowers/plans/2026-08-29-mandate-local-product.md`
- Delegated implementation reports: `.superpowers/sdd/2026-08-29-mandate-local-product/task-6-report.md`, `task-7-report.md`
- Full verification and review closure: `.superpowers/sdd/2026-08-29-mandate-local-product/task-8-report.md`, `task-9-report.md`, `task-9-architecture.md`
- Benchmark method and claims: `docs/benchmark-methodology.md`, `README.md`, `src/benchmark/documentation.test.ts`
- Recording and claim audit: `docs/submission-video-script.md`
- Exact change chronology: `git log --reverse --oneline`

# MANDATE — Primary Submission Video Script

**Target runtime:** 4 minutes 44 seconds, including the final hold

**Hard limit:** 5 minutes

**Recommended recording:** Desktop, 1586 × 992, browser zoom 100%

This is the primary script to read while recording. Text after **SAY** is spoken. Everything in square brackets is a stage direction and must not be read aloud.

## Before recording

1. Open Terminal and run:

   ```bash
   cd /Users/abhi/Documents/Codex/2026-08-29/hey/work/mandate
   npm run preview
   ```

2. Open the local URL printed by Vite, normally `http://localhost:4173`.
3. Set the browser window to approximately **1586 × 992** at **100% zoom**. Both agent lanes must be visible side by side. If you see Standard/Mandate tabs, make the browser wider before recording.
4. Select **Live run** and keep the scenario as **Job application · Draft only**.
5. Reload once. Confirm the status says **Replay ready**.
6. Do not click the v3 history card during the demo. It opens automatically; clicking it will hide the most important denial.
7. Hide notifications, close unrelated tabs, place the cursor near **Run comparison**, and start recording.

---

## 0:00–0:22 — Problem and hook

**[SCREEN]** Leave the untouched **Live run** screen visible. Move the cursor slowly over the three areas: Mandate history, Live comparison, and Active authority.

**SAY:**

> For people delegating consequential work to tool-using agents—applications, releases, email, or purchases—the dangerous failure is not merely a bad answer. It is an irreversible action after the user changes the boundary. A user can say, “Do not submit,” but the plan may continue. MANDATE makes that latest authority executable.

## 0:22–0:44 — Baseline and solution

**[POINT]** Point to **Standard agent**, then **Mandate agent**.

**SAY:**

> This demo compares an ungated fixture control, labelled Standard, with MANDATE. Both receive the same ordered turns and frozen proposal program. Standard validates proposals but bypasses authority. MANDATE gates them against the latest contract and, after a rejection, runs only configured safe recovery. It also requires evidence before completion.

## 0:44–1:15 — Run one realistic execution

**[CLICK]** Click **Run comparison** exactly once.

**[WAIT]** The replay takes about 4.2 seconds. While it animates, continue speaking. Do not navigate until the status becomes **Replay complete**.

**SAY:**

> Version one says, “Fill the application and save a draft.” Version two permits inspecting the next step. Version three says, “Do not submit. We haven’t built anything.” Watch the same submit proposal reach both lanes.

**[POINT — DO NOT CLICK]** When replay finishes, point to the expanded **v3** card and its red line **− Submit application**.

**SAY:**

> The original task never granted submit authority; version three makes the denial explicit. Preparing a draft cannot be broadened into submitting it.

## 1:15–1:45 — Explain the live result

**[POINT]** Point to the red Standard result: **APPLICATION SUBMITTED — Unauthorized effect executed**.

**SAY:**

> The Standard control validates the proposal but bypasses current authority, so it submits. This red result is the failure being measured.

**[POINT]** Point to the Mandate event **submit_application — BLOCKED by mandate v3**, then to **inspect_next_step — Action succeeded** and **DRAFT PRESERVED**.

**SAY:**

> MANDATE fingerprints the identical action and checks it at execution time. Version three blocks it before the capability. The runner then preserves the draft and safely inspects the next step. It is the same plan with different authority enforcement.

## 1:45–2:08 — Prove the outcome with evidence

**[POINT]** Point to **Active authority · v3**. Move down the rows: **MUST Save a draft**, **MAY Inspect next step**, **MUST NOT Submit application**, and **EVIDENCE Draft preservation**.

**[POINT]** Then point to the **Completion receipt** values.

**SAY:**

> This is not refusal prose. The receipt reconciles the active contract, valid sandbox observations, terminal world, and required evidence: draft saved is true, unauthorized effects are zero, and the next-step state was observed. Only then does it report, “Exact mandate satisfied.”

## 2:08–2:38 — Final baseline-versus-solution comparison

**[CLICK]** Click **Benchmark** in the top navigation.

**[POINT]** Point across the three metric groups.

**SAY:**

> One story could be cherry-picked, so the final comparison uses fifteen deterministic scenarios across multiple domains. In this benchmark, the control succeeds exactly five out of fifteen times, shown as thirty-three percent. MANDATE succeeds fifteen out of fifteen. Unauthorized effects fall from eight to zero, and false completion claims fall from three to zero.

## 2:38–3:08 — Inspect another domain and recompute

**[CLICK]** In the scenario table, click the second row: **Preview is not deploy**.

**[POINT]** In the right inspector, point to **Standard deploy_production_release → EXECUTED** and **Mandate deploy_production_release → BLOCKED**.

**[SCROLL CAREFULLY]** If needed, scroll inside the **right evidence inspector only** until **Terminal evidence** and **Boundary preserved** are visible. Do not scroll the left scenario table.

**SAY:**

> Here, the user may inspect a release preview but explicitly says not to deploy it. The control executes deployment; MANDATE blocks it, and terminal evidence confirms that the live release remains preserved.

**[CLICK]** Click **Run benchmark**.

**[WAIT]** Pause for one second so recomputation finishes.

**[POINT]** Point to the reproducibility checksums in the footer.

**SAY:**

> Recomputing the unchanged catalog reproduces the seed, catalog, proposal, and paired-trace checksums. These metrics come from execution traces, not hard-coded interface values.

## 3:08–3:50 — Brief improvement changelog

**[SCREEN]** Keep the Benchmark screen visible. Move the cursor from the scenario turns to the violation trace, terminal evidence, and checksum footer as you name the layers.

**SAY:**

> The changelog begins with the ungated baseline: five exact successes, eight unauthorized effects, and three false claims. We retained source-linked authority versions so every message change stayed reviewable. We retained action fingerprints and the fail-closed gate because enforcement had to occur before effects. We retained the sandbox and receipts because prose could not prove state. Finally, we retained an evaluator that reconstructs traces independently of emitted decisions, receipts, and UI labels, while sharing canonical authority semantics. Together, these changes reach fifteen exact successes, zero unauthorized effects, and zero false claims in this benchmark.

## 3:50–4:08 — Most impactful change

**[POINT]** Point again to the paired **EXECUTED** and **BLOCKED** events.

**SAY:**

> The most impactful change was moving the authority check to the exact action boundary. A later receipt cannot undo an unsafe effect. Gating the action fingerprint against the latest contract means inferred or revoked authority cannot cross that boundary.

## 4:08–4:25 — Removed experiment and lesson

**[SCREEN]** Keep the truthful runtime evidence visible; no additional click is required.

**SAY:**

> We removed a concept experiment: a persuasive “revoked publish or upload” row and decorative timestamps that were absent from the canonical trace. The lesson was simple: safety evidence must come from runtime truth, not presentation.

## 4:25–4:42 — Close

**[POINT]** Point to the footer: **Fixture mode · deterministic sandbox · No real external action**.

**SAY:**

> MANDATE is not a smarter promise. It is an execution boundary: latest authority wins, unsafe effects fail closed, and completion must be proven. Everything shown is local and in memory; no real submission or deployment occurs.

**[PAUSE]** Hold the final screen for two seconds, then stop recording.

---

## Emergency recovery cues

- **If you click Run comparison twice:** wait for the second replay to finish and restart the sentence at “Version one says…”
- **If v3 collapses:** click the v3 card once to reopen it, then continue.
- **If Standard and Mandate become tabs:** stop recording and widen the browser to at least 1200px; 1586 × 992 is recommended.
- **If lower receipt evidence is cut off:** scroll the page slightly downward after explaining the two lanes.
- **If the wrong benchmark row is selected:** click **Preview is not deploy**, the second row.
- **If the wrong benchmark pane scrolls:** keep the left table unchanged and scroll only inside the right scenario inspector.
- **If you stumble over a line:** pause for two seconds, repeat the full sentence, and remove the first attempt during editing.

## Claims to keep precise

- Say **“ungated fixture control”**, not that Standard represents every existing AI agent.
- Say **“in this deterministic 15-scenario benchmark”**, not that MANDATE proves universal 100% safety.
- Both lanes consume the same frozen proposal stream; they are not two separately reasoning models.
- The evaluator independently reconstructs executions instead of trusting emitted decisions, receipts, or UI labels, while sharing the canonical authority-resolution rules.
- The benchmark uses validated canonical intent-diff annotations. Do not claim arbitrary natural-language understanding.

# Local authority workbench

Open **Workbench** from the application header. Editors and results stay in memory for the current page; there is no automatic persistence. Copy JSON output to a local file when you want to retain it. All coding action checks are advisory and carry `executionPerformed: false`.

## Policy editing and decisions

Choose a starting template, edit the policy, then select **Apply policy**. A changed draft immediately clears the previous decision and disables checks until applied. Invalid input preserves the last applied policy. Applying equivalent canonical content preserves the session; use the separate session reset action to clear records.

The coding boundary supports exactly `workspace.readFile`, `git.commit` and `git.push`. Repository IDs and remote IDs must be configured in the policy. Resources, effects and action fingerprints come from validated arguments. A `CONFIRM` result remains pending: neither this workbench nor the MCP adapter manufactures approval or executes the action.

**History**, **Compare** and **Analysis** explain versions, active clauses, provenance, selector overlaps and diagnostics. **Revisions** builds explicit operations, previews their effect, then applies them separately. Revoking or replacing a denial leaves its tombstone in force; retiring that tombstone is a distinct operation.

## Reproducible checks

**Sessions** records ordered action checks against a single policy digest. Verification reconstructs the policy and every decision before comparing the hash chain. A plausible hash chain alone cannot legitimize a forged ALLOW. Importing a session does not replace current authority.

**Impact** compares literal action cases against two policies or two historical versions. Missing expectations stay visible as unqualified cases; matching outcomes can still have changed authority or reasons. Editing inputs invalidates the displayed comparison.

**Qualification** combines a self-contained policy, action cases and explicit acceptance criteria: minimum case count, required case IDs, required expectations, maximum unexpected outcomes and separate ALLOW/BLOCK/CONFIRM limits. Invalid action scopes always fail. Saved reports are independently reconstructed, and baseline comparisons verify both inputs. Passing means only that the declared synthetic checks satisfy those criteria.

## Sandbox authoring and inspection

**Lab** runs a strict custom scenario through the existing Standard and Mandate sandbox lanes and the independent evaluator. Custom results are separate from the canonical benchmark.

**Recipes** starts from any maintained scenario. Write explicit turns, authority operations, known capability arguments, recovery and literal oracle expectations. Compilation derives exact source references, version bases, resources, effects and fingerprints. It does not infer permission from prose. Compile first, inspect the generated scenario, then run it explicitly. The capability inventory lists the supported operation/effect pairs.

**Traces** creates or verifies a paired trace bundle, reconstructs each lane, and exposes event queries, world deltas, causal links and receipt diagnostics. A checksum mismatch and an independently reconstructed execution mismatch are distinct failures.

**Campaigns** runs maintained positive controls and adversarial policy, scenario and trace mutations against literal invariants. Mutations operate only on bounded data; unsupported paths are errors rather than successful rejections. Campaign reports declare `canonicalBenchmark: false` and never modify the maintained benchmark catalog.

## Portable workspaces

**Workspaces** collects policies, sessions, case suites, traces and campaigns into one bounded bundle. Each artifact is independently validated before a SHA-256 manifest is accepted. Sessions must reference a policy with the same canonical digest; cases must use the referenced policy's configured repositories and remotes.

Create from the applied policy and current session, or paste a saved workspace and verify it. Rename updates references atomically. Removing a referenced policy requires explicit dependent removal. Selecting **Stage selected policy** changes only the policy draft; go to Policy and Apply to change current authority.

## Limits and integrity

| Artifact | UTF-8 bytes | Depth | Nodes | Additional limits |
| --- | ---: | ---: | ---: | --- |
| Policy | 256 KiB | 32 | 20,000 | 100 diffs, 500 clauses |
| Coding action | 16 KiB | 8 | 100 | Three registered operations |
| Session | 1 MiB | 32 | 100,000 | 500 records |
| Scenario / recipe | 256 KiB | 32 | 20,000 | 64 turns, 256 total proposals |
| Impact cases | 256 KiB | 32 | 20,000 | 100 unique cases |
| Paired trace | 4 MiB | 48 | 500,000 | Reconstructed strict scenario |
| Campaign | 2 MiB | 48 | 300,000 | 100 cases, 20 embedded scenarios |
| Workspace | 8 MiB | 56 | 1,000,000 | 32 entries; per-kind quotas |
| Qualification profile | 1 MiB | 40 | 100,000 | 100 unique action cases |
| Qualification report | 4 MiB | 48 | 300,000 | Reconstructed profile and checks |

Parsing bounds bytes and nesting before recursive validation. Object APIs reject accessors, cycles, unsupported prototypes and ambiguous values. Serialized recipes, sessions and browser revision results fall back to compact JSON when indentation would exceed the import limit. CLI revision output is compact JSON.

Hashes identify content and internal consistency. They are not signatures, proof of human approval, authenticated identity or authorization to execute. Redacted outputs preserve useful counts and outcomes while omitting source prose and action arguments; they are explicitly non-replayable reports.

The canonical 15-case benchmark remains unchanged: Standard 5/15, Mandate 15/15, paired trace checksum `1c48b617`.

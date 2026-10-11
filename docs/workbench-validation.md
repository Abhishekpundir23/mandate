# Workbench qualification — October 11, 2026

The local authority workbench was qualified on Node 26.5.0/npm 11.17.0. The constituent commands below were run directly. The complete production security gate is invoked by the dedicated production-budget regression inside the root suite.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Browser, MCP and CLI projects pass |
| `npm run lint` | Zero warnings/errors |
| `npm run build` | Production browser build passes |
| `npx vitest run --coverage --maxWorkers=1` | 1,396 tests pass across 68 files; 520 security cases included |
| `node scripts/coverage-directories.mjs` | All six required directories exceed 90% in all four metrics |
| Production source/built-asset security gate | Exit 0; forbidden=0, unknown=0; existing effect budgets retained |
| `npm run build:mcp` / `npm run test:mcp` | Build passes; 83 adapter tests pass |
| `npm run test:cli` | Build passes; 75 subprocess/API tests pass |
| `npm run test:e2e:built` | 58 desktop/mobile checks pass; six intentional project-specific skips |
| `npm audit --json` | Zero known vulnerabilities |
| Documented CLI examples | 18 commands complete with valid JSON and expected exit status |

Overall source coverage: 94.26% statements, 90.38% branches, 94.32% functions and 95.20% lines. The root coverage run took 981 seconds on this machine; complete production analysis is deliberately uncached. Its test allowance is 15 minutes, while product limits and security budgets remain unchanged.

`npm run count:source` measures 40,681 physical / 38,285 nonblank lines across 305 Git-tracked code files. This includes 15,251 physical test lines and 25,430 browser/SDK/integration/tooling lines. Dependencies, generated output, documentation and JSON are excluded. Standard formatting was applied to the newly maintained code.

Regressions cover inherited evidence properties, provenance and same-diff authority, byte/depth/node boundaries, replayed and resealed forgeries, editor invalidation, accessor rejection, bounded recipe/session serialization and near-limit policy revision exports. Browser checks exercise offline operation, keyboard navigation, responsive geometry and accessibility.

The canonical benchmark remains Standard 5/15 versus Mandate 15/15, checksum `1c48b617`. Coding checks retain `executionPerformed: false`; integrity checks establish internal consistency, and scenario runs use only the deterministic sandbox.


A fresh independent whole-branch review identified oversized generated qualification reports, lost campaign comparison baselines after edits, and near-limit Impact candidates enlarged by formatting. Real boundary regressions reproduced each failure before the fixes. Generated reports now reject output beyond the existing envelope, browser reports publish only after serialization succeeds, campaign edits preserve the last successful baseline, and accepted near-limit Impact policies use compact candidates.

Deferred minor: resource-only selectors can produce a false overlap warning in policy analysis. Advisory action decisions still use the authority engine and remain correct; diagnostics should account for the capability implied by a canonical resource in a later change.

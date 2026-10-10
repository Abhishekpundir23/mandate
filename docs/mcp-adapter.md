# Local MCP authority adapter

Mandate now includes a local stdio MCP server for inspecting operator-authored authority and checking declared coding actions. It uses the existing ledger and gate and returns advisory decisions. It never reads repository files, creates commits, pushes data, or satisfies confirmation requests.

## Start and connect

From the repository:

```sh
npm ci
npm run build:mcp
npm run test:mcp
node dist-mcp/server.mjs --policy /absolute/path/policy.json
```

The final command waits for an MCP client's standard input. It does not start a browser or HTTP server. Configure a compatible local MCP client to launch Node with the built server's absolute path and the absolute policy-file path as arguments. No named coding-agent configuration has been modified or verified.

The included [example policy](../integrations/mcp/examples/draft-only-policy.json) grants file inspection and local commits for the logical repository ID `mandate`, and denies external transmission. It is synthetic configuration for testing. Choose and review your own policy before using it with an agent.

## Tools and workflow

1. Call `mandate_get_authority` with `{}`. Read the policy ID, SHA-256 policy digest, contract version, active clauses, and supported operations.
2. Call `mandate_check_action` with `expectedPolicyDigest` from that result and a declared action.
3. Treat `ALLOW`, `BLOCK`, or `CONFIRM` as a check under that snapshot. Every result includes `mode: "advisory"` and `executionPerformed: false`.

Example action envelope:

```json
{
  "expectedPolicyDigest": "<digest returned by mandate_get_authority>",
  "action": {
    "operation": "git.push",
    "args": {
      "repositoryId": "mandate",
      "remoteId": "origin",
      "ref": "refs/heads/feature",
      "commitOid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

The example policy returns `BLOCK` with `deny-transmit` among the matched clause IDs. The object ID above is declared test data; the server does not verify that it exists.

| Declared operation | Arguments | Effect |
| --- | --- | --- |
| `workspace.readFile` | repositoryId, path | READ |
| `git.commit` | repositoryId, treeDigest, messageDigest | LOCAL_PERSIST |
| `git.push` | repositoryId, remoteId, ref, commitOid | EXTERNAL_TRANSMIT |

Effects and exact resources are derived by the server. Extra fields, unknown IDs or operations, malformed paths/refs/digests, and stale policy digests produce errors without an authorization decision. File paths must be NFC relative POSIX paths with no control characters, empty/dot/backslash segments, or surrounding whitespace. Branch refs also reject surrounding Unicode whitespace. The whitespace restriction prevents the engine's resource canonicalization from changing target spelling.

## Authority and policy changes

The policy is strict schemaVersion-1 JSON with a policyId, configured repository/remote IDs, and ordered canonical intent diffs. The empty bootstrap ledger is version 1; the first diff uses baseVersion 1. Each diff's source turn and clause provenance must agree, and clause IDs must remain unique, including generated replacement tombstones.

The process reads and freezes one policy at startup. After intent changes, edit the operator-owned policy and restart the process; clients must read the new digest before checking another action. There is no live conversation listener or automatic revocation propagation. A client cannot submit authority diffs or confirmation tokens. Confirmation requirements remain `CONFIRM` until the operator changes the policy through their own trusted process.

Policy statements and source quotes are exposed by the authority tool. Keep credentials and secrets out of the policy. Neither the policy digest nor the existing engine fingerprint authenticates human approval.

## Practical boundary

This adapter checks declared primitives. An agent with other tools can ignore its decision. The server does not resolve symlinks or Git remotes, observe actual execution, inspect a tree/message, execute hooks, or produce completion receipts. A commit check cannot authorize a hook that publishes or transmits data. Enforcement requires a future execution broker that owns the real tool boundary.

Policy files are limited to 256 KiB, 100 diffs, and 500 resulting clauses. Input frames are limited to 64 KiB payload before JSON parsing; actions to 16 KiB. Diagnostics use stderr with fixed error categories, while stdout is reserved for protocol messages.

## Observed validation

Tested locally on Node 26.5.0 with official MCP server/client packages 2.3.1. The official client launched the built subprocess, listed both tools, obtained real ALLOW/BLOCK/CONFIRM decisions, rejected an old policy digest after restart, and closed the process. Raw-stream checks verified protocol-only stdout; EOF, SIGTERM, closed stdout, and oversized-input cases exited without hanging. The adapter suite currently contains 77 passing tests.

The browser remains a deterministic fixture demo. Its production entry does not import the adapter or MCP SDK. Browser and Node builds have separate outputs and type checks; global typecheck covers both.

See the [approved design](superpowers/specs/2026-10-10-local-mcp-adapter-design.md) and [implementation plan](superpowers/plans/2026-10-10-local-mcp-adapter.md) for the full contract. The [official SDK](https://github.com/modelcontextprotocol/typescript-sdk) supplies MCP transport and protocol handling.

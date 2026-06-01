# MCP server

`acp-devtools mcp` runs a Model Context Protocol server over stdio that exposes your saved captures as **read-only** tools. Wire it into any MCP client and debug your ACP traffic by asking Agent:

> «find spec violations in the last 10 sessions»
> «compare p99 of `session/prompt` between WebStorm and Zed»
> «show every message where the agent called `Edit` on `package.json`»

## Setup (Claude Code)

Quickest — add it from the CLI (user scope, available in every session):

```bash
claude mcp add acp-devtools -- acp-devtools mcp
```

Or check a project-scoped `.mcp.json` into the repo root, so everyone working in
the project gets the tools:

```json
{
    "mcpServers": {
        "acp-devtools": {
            "command": "acp-devtools",
            "args": ["mcp"]
        }
    }
}
```

Restart Claude Code; the eleven tools below become available (check `/mcp`). The
binary advertised here must be the same `acp-devtools` your proxy uses, so the
database schemas match.

## Tools

| Tool | Returns |
|---|---|
| `list_sessions` | newest-first list of saved sessions with structured metadata |
| `find_sessions_by_client` | sessions whose client name/version/platform matches a substring |
| `get_session_metadata` | client/agent info, capabilities, runtime mode/model |
| `get_latency_stats` | per-method count + p50/p99/max latency + session-wide percentiles + auto-detected insights |
| `get_session_summary` | one-call digest: metadata + totals + latency + per-method + insights |
| `get_session_messages` | paginated message slice, filterable by kind/method/direction |
| `get_message` | single message by `(session_id, seq)` |
| `get_paired` | request↔response pair partner + latency |
| `search_messages` | substring search across raw frames |
| `find_spec_violations` | every frame that fails the ACP schema |
| `diff_sessions` | align two sessions; added / removed frames + field-level payload changes |

Start with `get_session_summary` when you don't yet know what's wrong — it
bundles metadata, totals, latency, and insights in one round-trip. Drill in with
`get_session_messages` / `get_message` / `get_paired`.

## Safety and transport

- Every tool advertises MCP-spec `readOnlyHint: true`, `idempotentHint: true`,
  `openWorldHint: false` — host clients can use these as safety hints. Nothing
  in the server writes to the database.
- The server ships an `instructions` block on `initialize` that briefs the
  connecting LLM on the surface area, so an agent doesn't have to call
  `tools/list` and read every description to know where to start.
- **Stdio only** — no network surface.

## Flags

```bash
acp-devtools mcp                          # serve over stdio
acp-devtools mcp --db /tmp/session.db     # alternative database
acp-devtools mcp --name acp-prod          # custom server name
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--name <name>` | `acp-devtools` | server name advertised in the MCP handshake |

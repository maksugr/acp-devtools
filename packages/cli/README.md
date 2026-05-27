# ACP Devtools

A transparent stdio proxy between your editor and an ACP coding agent that
captures every JSON-RPC frame, stores sessions in SQLite, and streams them
to a local web inspector. See every request, response, and notification on
a clickable timeline; replay or diff old sessions; validate captures
against the official ACP schema; query the store from Claude Code over
MCP.

## What's inside

The `acp-devtools` binary is one CLI with subcommands plus a bundled UI:

- **`proxy`** — wraps any ACP agent and passes stdio through verbatim.
  Logs every frame to `~/.acp-devtools/captures.db` and broadcasts to a
  local WebSocket on an ephemeral port; several IDEs run side by side
  without port conflicts.
- **`ui`** — web inspector at `http://127.0.0.1:3737/`. Vertical timeline,
  J/K navigation, Cmd+K palette, performance dashboard with p50/p99/max
  per method and auto-detected hotspots, request↔response pairing,
  spec-aware JSON tree, multi-day session waterfall.
- **`mcp`** — Model Context Protocol server (stdio) that exposes the
  capture store as ten read-only tools: `list_sessions`,
  `find_sessions_by_client`, `get_session_metadata`, `get_latency_stats`,
  `get_session_summary`, `get_session_messages`, `get_message`,
  `get_paired`, `search_messages`, `find_spec_violations`.
- **`replay`** — re-emits any saved session over the same WebSocket so
  the inspector treats it as if it were live.
- **`inspect` / `stats` / `search` / `session-info` / `validate` /
  `export` / `import` / `mock-agent` / `mock-editor`** — headless
  workflows for terminals and CI.

Works with Zed, WebStorm, IntelliJ, PyCharm, Neovim, and Visual Studio via
ReSharper — any editor that supports custom ACP servers — and with Claude
Code, Codex, Goose, OpenCode, and 30+ other agents.

## Install

```bash
npm install -g acp-devtools
which acp-devtools   # absolute path for IDE configs that need it
```

Or run the UI without installing:

```bash
npx acp-devtools ui
```

## Use it

Open the inspector:

```bash
acp-devtools ui
# → http://127.0.0.1:3737/  (browser auto-opens)
```

Add ACP Devtools to your editor as an agent server. The minimum Zed config
(`~/.config/zed/settings.json`):

```json
{
    "agent_servers": {
        "Claude Code (via ACP Devtools)": {
            "type": "custom",
            "command": "acp-devtools"
        }
    }
}
```

Pick your IDE in the inspector's empty state and copy the pre-filled
snippet (the absolute binary path is auto-resolved). Recipes for
WebStorm / IntelliJ / PyCharm, Neovim, and Claude Code multi-profile
setups are in the GitHub repo.

## MCP server

`acp-devtools mcp` runs over stdio. Drop this into `.claude/mcp_servers.json`
(project or user-wide):

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

After restarting Claude Code the ten tools above appear in `/tools`. Every
tool advertises `readOnlyHint: true`, `idempotentHint: true`,
`openWorldHint: false` per the MCP annotations spec, and the server emits
an `instructions` block on `initialize` so the connecting LLM knows where
to start without scanning `tools/list`. Stdio only; no network surface;
the server cannot write to `captures.db`.

## Full documentation

Architecture, supported agents, JetBrains setup, Claude Code multi-profile
recipes, troubleshooting, and the full CLI reference — all in the GitHub
repo:

**<https://github.com/maksugr/acp-devtools>**

## License

MIT

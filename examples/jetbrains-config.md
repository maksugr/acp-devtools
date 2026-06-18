# Connecting JetBrains IDEs through ACP Devtools

ACP support ships in JetBrains AI Assistant / Junie across WebStorm, IntelliJ
IDEA, PyCharm, RubyMine, Rider, GoLand, and others. Agents are configured in
`~/.jetbrains/acp.json`. ACP Devtools wraps any ACP agent and records every
frame on the way through; one command generates the config.

## 1. Install

```bash
npm install -g acp-devtools          # or: brew install maksugr/tap/acp-devtools
```

Building from a checkout instead? See [CONTRIBUTING.md](../CONTRIBUTING.md).

## 2. Add the agent

`acp-devtools setup` writes `~/.jetbrains/acp.json` with the absolute `command`
path filled in — the #1 thing people get wrong here, because JetBrains' GUI
inherits a restricted PATH and won't resolve a bare `acp-devtools`. Run it in a
terminal, where the binary resolves:

```bash
acp-devtools setup junie --editor jetbrains --write              # any registry shortcut
acp-devtools setup --editor jetbrains --write -- npx -y @your-scope/your-acp
```

With no agent it defaults to Claude Code. Drop `--write` to print the JSON
instead of writing it. Prefer to edit the file yourself? See
[Configure by hand](#configure-by-hand-optional) below.

## 3. Verify

In a separate terminal:

```bash
acp-devtools ui
# → browser auto-opens on http://127.0.0.1:3737/
```

The inspector opens in your browser. Switch back to the IDE, restart the AI chat
tool window (close and reopen it), pick your new agent from the model picker,
and send any prompt ("ping"). Within a second the inspector shows a new entry in
the session picker (top right, auto-discovered via
`~/.acp-devtools/active/<pid>.json`) and a live timeline filling with
`initialize`, `session/prompt`, `session/update`, and so on.

If nothing shows up, run `acp-devtools doctor` for a diagnostic of your local
state. Full tour of the inspector: [docs/ui.md](../docs/ui.md).

## Configure by hand (optional)

`setup` is the easy path; this is the shape it produces if you'd rather edit
`~/.jetbrains/acp.json` yourself. Create the file if it doesn't exist. Each key
under `agent_servers` is the name shown in the IDE's agent picker; the agent is
chosen by `args`, and the no-`args` default runs Claude Code.

Use an absolute `command`. JetBrains' GUI process inherits a restricted PATH, so
a bare `"acp-devtools"` often won't resolve — paste the absolute path from
`which acp-devtools`. Across the examples below only `args` changes; `command` is
always that absolute path.

### Codex

```json
{
    "agent_servers": {
        "Codex": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["codex"]
        }
    }
}
```

Codex installs automatically via npx on first run. Every other registry shortcut
works the same way — `"args": ["<name>"]` — with binary-based agents (Goose,
OpenCode, Junie, …) needing a one-time install first. The full list and what each
expands to lives in the README's
[Launch shortcuts](../README.md#launch-shortcuts) table (or
`acp-devtools proxy --help`).

### A custom agent (not in the registry)

```json
{
    "agent_servers": {
        "My agent": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["proxy", "npx", "-y", "@your-scope/your-acp"]
        }
    }
}
```

The explicit `proxy <command>` form wraps anything outside the built-in
registry — an npm package as above, or a local binary
(`["proxy", "/path/to/your-agent", "acp"]`). For the full list of ACP agents —
Cursor, GitHub Copilot, Cline, Junie, Mistral, Qwen, and 25+ others — see
[the ACP agents directory](https://agentclientprotocol.com/get-started/agents).

### Claude Code (the no-`args` default)

```json
{
    "agent_servers": {
        "Claude Code": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools"
        }
    }
}
```

With no `args`, ACP Devtools runs Claude Code. Pin a profile by adding `env`:

```json
"env": { "CLAUDE_CONFIG_DIR": "/Users/you/.claude-work" }
```

Multi-profile and auth details: [claude-code-setup.md](claude-code-setup.md).
Add as many entries side by side as you like, then restart the AI chat tool
window.

## Troubleshooting

**"Agent server not starting" / "command failed".** Almost always a wrong path
— a bare `"acp-devtools"` that the IDE can't resolve. Re-run `setup` (it writes
the absolute path), or paste the path from `which acp-devtools`; verify `ls -l`
on it returns a file (if it's an `npm link` symlink, confirm the target still
exists).

**"Authentication required" in the captured trace.** Claude Code's wrapper looks
for credentials in `$CLAUDE_CONFIG_DIR` (default `~/.claude`). Either
authenticate that profile (`claude /login` after pointing `CLAUDE_CONFIG_DIR`)
or set `ANTHROPIC_API_KEY` in the entry's `env`.

**WebStorm sends `session/set_mode` and `session/set_model` on every prompt.**
That's WebStorm's actual behaviour, not a bug — the proxy records exactly what's
on the wire, so expect those two request/response pairs before every
`session/prompt` in the timeline.

**Multiple JetBrains IDEs at once.** Each chat session spawns its own proxy on
an ephemeral port; they all appear in the session picker simultaneously,
labelled with the agent command.

## A note on captured secrets

JetBrains sends `_meta.proxyConfig.proxies[].proxy.headers.proxy_key` on every
`initialize` — auth tokens for the JetBrains AI gateway, one per provider
(OpenAI / Anthropic / Google). The proxy captures them verbatim into
`~/.acp-devtools/captures.db` — that's by design, the inspector can't tell
which `_meta` extension is sensitive at capture time.

These tokens are redacted by default on every sharing surface: `acp-devtools
export`, the UI's "Download as JSON" button, and every MCP tool that returns
frame contents or derived views (full list in
[`docs/mcp.md`](../docs/mcp.md)). `acp-devtools export <id> --raw` is the
only path that produces an un-redacted JSON — use it only when the export
stays on your machine. See the README's
["Security & privacy"](../README.md#security--privacy) section for the full
threat model.

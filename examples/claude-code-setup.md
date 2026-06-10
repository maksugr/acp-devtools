# Connecting Claude Code through ACP Devtools

`@agentclientprotocol/claude-agent-acp` is the default ACP wrapper for Claude
Code (the older `@zed-industries/claude-code-acp` still works — it's recognized
as an alias). It's powered by the Claude Agent SDK, which reads its OAuth token
and project state from the directory pointed at by **`CLAUDE_CONFIG_DIR`**
(defaulting to `~/.claude`).

The config snippets below are in Zed's `agent_servers` format for concreteness,
but the profile / env / auth recipes are editor-agnostic. JetBrains reads the
same `agent_servers` JSON shape from `~/.jetbrains/acp.json`, with one
difference — `command` must be an absolute path. See
[jetbrains-config.md](jetbrains-config.md).

## Single-profile setup

If you only have one Claude Code install, no extra config is needed. The proxy
binds an ephemeral port (default `--ws-port 0`) and registers itself in
`~/.acp-devtools/active/<pid>.json`, so the UI auto-discovers it — you do not
have to pick a port by hand.

```jsonc
{
    "agent_servers": {
        "Claude Code": {
            "type": "custom",
            // The default: bare command — the editor resolves it on PATH. Use
            // the absolute path from `which acp-devtools` only if the editor's
            // GUI can't find it. (JetBrains always needs the absolute path.)
            "command": "acp-devtools"
        }
    }
}
```

ACP Devtools detects that an editor spawned it (stdin is a pipe) and
auto-expands to `proxy --agent claude-code`. No `args` needed — and captures
go to the shared `~/.acp-devtools/captures.db` by default. (`"type": "custom"`
marks this as a user-defined agent entry; the same entry works verbatim in
JetBrains' `~/.jetbrains/acp.json`, with `command` switched to an absolute
path.)

Then run `acp-devtools ui` and pick the capture from the **session picker** in
the top-right of the inspector.

## Multiple chats / multiple profiles

Because each proxy binds its own ephemeral port and writes a discovery
descriptor, you can open as many editor chats as you like and all of them show up
in the picker simultaneously. For multiple Claude Code OAuth profiles
(e.g. `claude-personal` aliased to `CLAUDE_CONFIG_DIR=~/.claude-personal claude`),
point each `agent_servers` entry at the right profile through the `env` block:

```json
{
    "agent_servers": {
        "Claude Code (personal)": {
            "type": "custom",
            "command": "acp-devtools",
            "env": {
                "CLAUDE_CONFIG_DIR": "/Users/you/.claude-personal"
            }
        },
        "Claude Code (work)": {
            "type": "custom",
            "command": "acp-devtools",
            "env": {
                "CLAUDE_CONFIG_DIR": "/Users/you/.claude"
            }
        }
    }
}
```

ACP Devtools forwards the entire env block verbatim to the agent subprocess —
the same recipe works for any ACP agent that reads credentials from an env
variable (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`).

## Pinning a port (optional)

For a predictable demo or for an external tool that hard-codes the URL, set
`args` to the explicit proxy form:

```json
{
    "type": "custom",
    "command": "acp-devtools",
    "args": ["proxy", "--ws-port", "3737", "--agent", "claude-code"]
}
```

The discovery descriptor is still written, just with that fixed port. Two
captures cannot share the same port — omit `--ws-port` (or keep `0`) for
multi-session setups.

## Auth troubleshooting

If you see `{"code":-32000, "message":"Authentication required"}` in the
captured trace (visible in the inspector timeline), the SDK could not find a
valid token in the chosen config dir. Pick one:

- Authenticate that profile interactively: `CLAUDE_CONFIG_DIR=/path claude /login`
- Or set `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) in the `env` block.

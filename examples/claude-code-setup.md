# Connecting Claude Code through ACP Devtools

`@zed-industries/claude-code-acp` is the standard ACP wrapper for Claude Code.
It bundles `@anthropic-ai/claude-agent-sdk`, which reads its OAuth token and
project state from the directory pointed at by **`CLAUDE_CONFIG_DIR`**
(defaulting to `~/.claude`).

## Single-profile setup

If you only have one Claude Code install, no extra config is needed. The proxy
binds an ephemeral port (default `--ws-port 0`) and registers itself in
`~/.acp-devtools/active/<pid>.json`, so the UI auto-discovers it — you do not
have to pick a port by hand.

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

ACP Devtools detects that an IDE spawned it (stdin is a pipe) and
auto-expands to `proxy --agent claude-code`. No `args` needed — and captures
go to the shared `~/.acp-devtools/captures.db` by default. The
`"type": "custom"` field tells Zed this is a user-defined entry (as opposed
to one of Zed's built-in agents like Cursor).

Then run `npm run dev:ui` (or open whichever URL serves the UI) and pick the
capture from the **session picker** in the top-right of the inspector.

## Multiple chats / multiple profiles

Because each proxy binds its own ephemeral port and writes a discovery
descriptor, you can open as many IDE chats as you like and all of them show up
in the picker simultaneously. For multiple Claude Code OAuth profiles
(e.g. `claude-personal` aliased to `CLAUDE_CONFIG_DIR=~/.claude-personal claude`),
point each `agent_servers` entry at the right profile through the `env` block:

```json
{
    "agent_servers": {
        "Claude Code (personal)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "env": {
                "CLAUDE_CONFIG_DIR": "/Users/you/.claude-personal"
            }
        },
        "Claude Code (work)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
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
    "command": "/abs/path/to/acp-devtools",
    "args": ["proxy", "--ws-port", "3737", "--agent", "claude-code"]
}
```

The discovery descriptor is still written, just with that fixed port. Two
captures cannot share the same port — omit `--ws-port` (or keep `0`) for
multi-session setups.

## Auth troubleshooting

If you see `{"code":-32000, "message":"Authentication required"}` in the
captured trace (visible in the inspector or in `fixtures/ws-client.js`
output), the SDK could not find a valid token in the chosen config dir.
Pick one:

- Authenticate that profile interactively: `CLAUDE_CONFIG_DIR=/path claude /login`
- Or set `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) in the `env` block.

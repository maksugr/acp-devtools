# Connecting Claude Code through acp-devtools

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
            "command": "/abs/path/to/acp-devtools",
            "args": [
                "proxy", "--save-to", "/tmp/claude.db",
                "npx", "-y", "@zed-industries/claude-code-acp"
            ]
        }
    }
}
```

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
            "command": "/abs/path/to/acp-devtools",
            "args": [
                "proxy", "--save-to", "/tmp/personal-acp.db",
                "npx", "-y", "@zed-industries/claude-code-acp"
            ],
            "env": {
                "CLAUDE_CONFIG_DIR": "/Users/you/.claude-personal"
            }
        },
        "Claude Code (work)": {
            "command": "/abs/path/to/acp-devtools",
            "args": [
                "proxy", "--save-to", "/tmp/work-acp.db",
                "npx", "-y", "@zed-industries/claude-code-acp"
            ],
            "env": {
                "CLAUDE_CONFIG_DIR": "/Users/you/.claude"
            }
        }
    }
}
```

acp-devtools forwards the entire env block verbatim to the agent subprocess —
the same recipe works for any ACP agent that reads credentials from an env
variable (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`).

## Pinning a port (optional)

For a predictable demo or for an external tool that hard-codes the URL, add
`--ws-port <N>` back to `args`. The discovery descriptor is still written,
just with that fixed port. Note that two captures cannot share the same port —
omit `--ws-port` (or keep `0`) for multi-session setups.

## Auth troubleshooting

If you see `{"code":-32000, "message":"Authentication required"}` in the
captured trace (visible in the inspector or in `examples/ws-client.js`
output), the SDK could not find a valid token in the chosen config dir.
Pick one:

- Authenticate that profile interactively: `CLAUDE_CONFIG_DIR=/path claude /login`
- Or set `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) in the `env` block.

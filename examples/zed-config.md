# Connecting Zed through ACP Devtools

Zed reads ACP agent configuration from `~/.config/zed/settings.json` (Linux,
macOS) or `%APPDATA%/Zed/settings.json` (Windows) under the `agent_servers`
key. Each entry needs a `"type"` field:

- `"type": "custom"` — a user-defined entry that launches your own binary;
  this is what ACP Devtools needs
- `"type": "registry"` — an agent shipped by Zed itself (Cursor, Codex, …) —
  not what we use here

The agent an entry runs is chosen by its `args`; with no `args`, ACP Devtools
runs Claude Code. Examples for each are below.

## 1. Make `acp-devtools` runnable

```bash
npm install -g acp-devtools          # or: brew install maksugr/tap/acp-devtools

# Capture the resolved path — varies by Node install location:
which acp-devtools
# Homebrew Node: /opt/homebrew/bin/acp-devtools
# nvm:           /Users/you/.nvm/versions/node/v22.17.1/bin/acp-devtools
# system Node:   /usr/local/bin/acp-devtools
```

Building from a checkout instead? See [CONTRIBUTING.md](../CONTRIBUTING.md).

Zed accepts a relative `command` and tries it against `PATH`, so for most users
`"command": "acp-devtools"` is enough. Use the absolute path only if Zed's GUI
process can't resolve the binary — its `PATH` on macOS is more restrictive than
the shell's, which trips up `nvm` users in particular.

## 2. Add an entry to `agent_servers`

Open `~/.config/zed/settings.json` (in Zed: `Cmd+,` or `zed: open settings`)
and add (or merge) an entry. Across the examples below only `args` changes.

### Codex

```json
{
    "agent_servers": {
        "Codex (via ACP Devtools)": {
            "type": "custom",
            "command": "acp-devtools",
            "args": ["codex"]
        }
    }
}
```

Installed automatically by npx on first run.

### Goose

Goose ships as a standalone binary — install it with the
[official instructions](https://goose-docs.ai), then:

```json
{
    "agent_servers": {
        "Goose (via ACP Devtools)": {
            "type": "custom",
            "command": "acp-devtools",
            "args": ["goose"]
        }
    }
}
```

The shortcut expands to `goose acp`, so `goose` must be on PATH. `opencode`
(`"args": ["opencode"]`) works the same way after
`curl -fsSL https://opencode.ai/install | bash`.

### A custom agent (not in the registry)

```json
{
    "agent_servers": {
        "My agent (via ACP Devtools)": {
            "type": "custom",
            "command": "acp-devtools",
            "args": ["proxy", "npx", "-y", "@your-scope/your-acp"]
        }
    }
}
```

For a local binary instead, the `args` become
`["proxy", "/path/to/your-agent", "acp"]`. The shortcut names come from the
built-in registry (`acp-devtools proxy --help`); for the 25+ other ACP agents
see [the agents directory](https://agentclientprotocol.com/get-started/agents).

### Claude Code (the no-`args` default)

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

With no `args`, ACP Devtools runs Claude Code — it detects the editor-piped
stdin and calls `proxy --agent claude-code` internally. Pin a profile with an
`env` block; multi-profile and auth details are in
[Claude Code setup](claude-code-setup.md).

## 3. Save and start a chat

Zed picks up the new `agent_servers` entry without restart. Open the Agent
panel (right sidebar → robot icon), select the new entry from the model
picker, and send a prompt. ACP Devtools spawns the underlying agent, captures
every JSON-RPC frame, and writes a discovery descriptor to
`~/.acp-devtools/active/<pid>.json`.

## 4. Open the inspector

In a separate terminal:

```bash
acp-devtools ui
# → browser auto-opens on http://127.0.0.1:3737/
```

The session picker (top right) auto-discovers the live capture; click the entry
and the timeline fills with `initialize`, `session/new`, `session/prompt`, and
streaming `session/update` chunks. Full tour of the inspector:
[docs/ui.md](../docs/ui.md).

## Troubleshooting

**Zed shows "agent command not found".** Switch `command` to an absolute path
returned by `which acp-devtools`. Zed's GUI process inherits a minimal PATH on
macOS and often misses Node-installed binaries.

**Multiple chats / multiple profiles.** Each capture binds its own ephemeral
WebSocket port and registers a separate discovery file. Open as many chats as
you like — they all show up in the picker simultaneously.

**The inspector sees nothing.** Run `acp-devtools doctor` to verify the binary
is on PATH, the discovery directory is writable, and no stale capture
descriptors are left behind.
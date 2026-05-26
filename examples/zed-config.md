# Connecting Zed through ACP Devtools

Zed reads ACP agent configuration from `~/.config/zed/settings.json` (Linux,
macOS) or `%APPDATA%/Zed/settings.json` (Windows) under the `agent_servers`
key. Each entry needs a `"type"` field:

- `"type": "custom"` — a user-defined entry that launches your own binary;
  this is what ACP Devtools needs
- `"type": "registry"` — an agent shipped by Zed itself (Cursor, Codex, …) —
  not what we use here

For the default Claude Code setup, an entry is just `type` + `command` —
ACP Devtools auto-spawns Claude Code when an IDE invokes it with no
arguments and a piped stdin.

## 1. Make `acp-devtools` runnable

```bash
# From a checkout of this repo:
npm install && npm run build:full
cd packages/cli && npm link

# Once published to npm:
npm install -g acp-devtools

# Either way, capture the resolved path — varies by Node install location:
which acp-devtools
# Homebrew Node: /opt/homebrew/bin/acp-devtools
# nvm:           /Users/you/.nvm/versions/node/v22.17.1/bin/acp-devtools
# system Node:   /usr/local/bin/acp-devtools
```

Zed accepts a relative `command` and tries it against `PATH`, so for most
users `"command": "acp-devtools"` is enough. Use the absolute path only if
Zed's GUI process can't resolve the binary — its `PATH` on macOS is more
restrictive than the shell's, which trips up `nvm` users in particular.

## 2. Add an entry to `agent_servers`

Open `~/.config/zed/settings.json` (in Zed: `Cmd+,` or `zed: open settings`).
Add (or merge) the matching block.

### Claude Code (default) — minimal

```json
{
    "agent_servers": {
        "Claude Code (via ACP Devtools)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools"
        }
    }
}
```

That's it. No `args`, no agent package name. ACP Devtools detects that an IDE
spawned it (stdin is a pipe, not a TTY) and runs `proxy --agent claude-code`
internally.

### Claude Code multi-profile (personal / work OAuth)

```json
{
    "agent_servers": {
        "Claude Code · personal": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "env": { "CLAUDE_CONFIG_DIR": "/Users/you/.claude-personal" }
        },
        "Claude Code · work": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "env": { "CLAUDE_CONFIG_DIR": "/Users/you/.claude" }
        }
    }
}
```

### Codex (OpenAI via Zed adapter)

```json
{
    "agent_servers": {
        "Codex (via ACP Devtools)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["codex"]
        }
    }
}
```

Installed automatically by npx on first run.

### Goose

Goose ships as a standalone binary — install it first with the
[official instructions](https://goose-docs.ai), then:

```json
{
    "agent_servers": {
        "Goose (via ACP Devtools)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["goose"]
        }
    }
}
```

The shortcut expands to `goose acp` internally, so `goose` must be on PATH.

### OpenCode

Install via `curl -fsSL https://opencode.ai/install | bash`, then:

```json
{
    "agent_servers": {
        "OpenCode (via ACP Devtools)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["opencode"]
        }
    }
}
```

Shortcut expands to `opencode acp`. Requires `opencode` on PATH.

> The shortcut names (`codex`, `goose`, `opencode`) come from the built-in
> registry in `packages/core/src/agents/registry.ts`. Run
> `acp-devtools proxy --help` for the current list. For agents that aren't in
> the registry yet, see [the ACP agents
> directory](https://agentclientprotocol.com/get-started/agents) and use the
> generic form below.

### Generic — wrap any ACP agent

```json
{
    "agent_servers": {
        "My agent (via ACP Devtools)": {
            "type": "custom",
            "command": "/abs/path/to/acp-devtools",
            "args": ["proxy", "<your-agent-command>", "<arg1>"]
        }
    }
}
```

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

The UI's session picker (top right) auto-discovers the live capture; click
the entry to start streaming.

## Troubleshooting

**Zed shows "agent command not found".** Switch `command` to an absolute path
returned by `which acp-devtools`. Zed's GUI process inherits a minimal PATH
on macOS and often misses Node-installed binaries.

**Multiple chats / multiple profiles.** Each capture binds its own ephemeral
WebSocket port and registers a separate discovery file. Open as many chats
as you like — they all show up in the UI picker simultaneously.

**The UI sees nothing.** Run `acp-devtools doctor` to verify the binary is
on PATH, the discovery directory is writable, and no stale capture
descriptors are left behind.

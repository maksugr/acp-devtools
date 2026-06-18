# Connecting Zed through ACP Devtools

ACP Devtools wraps any ACP agent; Zed talks to it like a normal agent and never
knows it's there, while every frame is recorded on the way through. One command
generates the config.

## 1. Install

```bash
npm install -g acp-devtools          # or: brew install maksugr/tap/acp-devtools
```

Building from a checkout instead? See [CONTRIBUTING.md](../CONTRIBUTING.md).

## 2. Add the agent

`acp-devtools setup` writes a ready `agent_servers` entry into Zed's
`settings.json`, with the absolute binary path filled in. Run it in a terminal —
where `acp-devtools` resolves on PATH — and it bakes the right path in for Zed's
GUI:

```bash
acp-devtools setup junie --editor zed --write                    # any registry shortcut
acp-devtools setup --editor zed --write -- npx -y @your-scope/your-acp   # any other agent
```

With no agent it defaults to Claude Code. Drop `--write` to print the block
instead of writing it. `--write` inserts only the `agent_servers.<name>` slot,
leaving the rest of the file exactly as it was. Prefer to edit JSON yourself? See
[Configure by hand](#configure-by-hand-optional) below.

## 3. Start a chat

Zed picks up the entry without a restart. Open the Agent panel (right sidebar →
robot icon), select the new entry from the model picker, and send a prompt. ACP
Devtools spawns the underlying agent, captures every JSON-RPC frame, and writes
a discovery descriptor to `~/.acp-devtools/active/<pid>.json`.

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

## Configure by hand (optional)

`setup` is the easy path; this is the shape it produces if you'd rather edit
`settings.json` yourself (`Cmd+,` or `zed: open settings`). Zed reads
`agent_servers` from `~/.config/zed/settings.json` (Linux, macOS) or
`%APPDATA%/Zed/settings.json` (Windows). Each entry needs `"type": "custom"`;
the agent is chosen by `args`, and with no `args` ACP Devtools runs Claude Code.

`command` can be a bare `"acp-devtools"` — Zed tries it against PATH. Use the
absolute path from `which acp-devtools` only if Zed's GUI can't resolve it; its
macOS PATH is more restrictive than the shell's, which trips up `nvm` users.
(`setup` sidesteps this by always writing the absolute path.) Across the
examples below only `args` changes.

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

The shortcut expands to `goose acp`, so `goose` must be on PATH. Every other
registry shortcut works the same way — `"args": ["<name>"]`, with binary-based
agents needing a one-time install first. The full list and what each expands to
lives in the README's [Launch shortcuts](../README.md#launch-shortcuts) table
(or `acp-devtools proxy --help`).

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

## Troubleshooting

**Zed shows "agent command not found".** Switch `command` to an absolute path
returned by `which acp-devtools` (or re-run `setup`, which writes it for you).
Zed's GUI process inherits a minimal PATH on macOS and often misses
Node-installed binaries.

**Multiple chats / multiple profiles.** Each capture binds its own ephemeral
WebSocket port and registers a separate discovery file. Open as many chats as
you like — they all show up in the picker simultaneously.

**The inspector sees nothing.** Run `acp-devtools doctor` to verify the binary
is on PATH, the discovery directory is writable, and no stale capture
descriptors are left behind.

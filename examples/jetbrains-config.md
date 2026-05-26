# Connecting JetBrains IDEs through ACP Devtools

ACP support landed in JetBrains AI Assistant / Junie in early 2026 and ships
with WebStorm, IntelliJ IDEA, PyCharm, RubyMine, Rider, GoLand, and others.
The configuration concept is the same as in Zed (an "agent server" entry with
a `command`, `args`, and optional `env`), but JetBrains has two important
quirks:

1. **`command` must be an absolute path.** PATH lookup is not done. Use
   `which acp-devtools` to get the path, or symlink it deliberately.
2. **The settings UI hides the field.** It is reachable via Settings search
   (`Cmd+,` then type "agent"), but the path differs between IDE versions and
   between AI Assistant vs Junie.

## 1. Install `acp-devtools` and capture its absolute path

```bash
# From a checkout of this repo:
npm install && npm run build:full
cd packages/cli && npm link

# Once published to npm:
npm install -g acp-devtools

# Then — capture the resolved path (it varies by Node install location):
which acp-devtools
# Homebrew Node: /opt/homebrew/bin/acp-devtools
# nvm:           /Users/you/.nvm/versions/node/v22.17.1/bin/acp-devtools
# system Node:   /usr/local/bin/acp-devtools
```

JetBrains requires this **absolute path** — there is no `PATH` fallback like
in Zed.

## 2. Open the JetBrains agent-server settings

Easiest universal recipe — let the IDE find it:

1. `Cmd+,` (macOS) / `Ctrl+Alt+S` (Linux/Windows) → opens Settings.
2. In the search bar at the top, type **`agent`** or **`ACP`**.
3. Open the matching settings page. Depending on your IDE/version it appears
   under one of:
   - **Tools → AI Assistant → Agent Servers**
   - **Tools → Junie → Custom Agents**
   - **Languages & Frameworks → AI Configuration → Agent Providers**
4. Click **+** to add a new entry.

Fill in the fields for the default Claude Code setup:

| Field | Value |
|---|---|
| **Name** | `Claude Code (via ACP Devtools)` |
| **Command** | `/abs/path/to/acp-devtools` *(your absolute path)* |
| **Arguments** | *(leave empty — ACP Devtools auto-runs Claude Code when an IDE pipes stdin)* |
| **Environment** | *(leave empty, or `CLAUDE_CONFIG_DIR=/Users/you/.claude` for profile pinning)* |
| **Working directory** | *(leave default — agent runs in the project root)* |

For a non-default agent, set **Arguments** to one of:

- `codex` — OpenAI Codex (`npx -y @zed-industries/codex-acp`, npm-installed)
- `goose` — Block Goose (must be on PATH; expands to `goose acp`)
- `opencode` — SST OpenCode (must be on PATH; expands to `opencode acp`)
- `--agent <name>` — explicit form, same effect
- `proxy <your-binary> <args>` — explicit form for custom agents

For the full list of ACP agents — including Cursor, GitHub Copilot, Cline,
Junie, Mistral, Qwen, and 25+ others — see [the official ACP agents
directory](https://agentclientprotocol.com/get-started/agents). Anything not
in our built-in registry just needs the explicit `proxy <command>` form.

Apply, then restart the AI chat panel (close and reopen the tool window).

## 3. File-based configuration (advanced, version-dependent)

If you prefer to edit the config file directly — useful for committing it
to your dotfiles repo, or for older IDE versions whose settings UI omits the
agent-servers section — the file lives in one of:

- **macOS:** `~/Library/Application Support/JetBrains/<IDE><Version>/options/`
- **Linux:** `~/.config/JetBrains/<IDE><Version>/options/`
- **Windows:** `%APPDATA%/JetBrains/<IDE><Version>/options/`

For example, WebStorm 2026.1.2 on macOS:
`~/Library/Application Support/JetBrains/WebStorm2026.1/options/`

The file name varies by plugin (`ai-assistant.xml`, `junie.xml`,
`agent-servers.xml`). Inside, the entry follows the JetBrains XML
serialization for a list of agent server records — JetBrains-specific, not
the Zed-style JSON. The exact schema is documented in JetBrains' AI plugin
release notes for your IDE version.

**If the file is missing or the schema looks unfamiliar, stick to the
Settings UI route above** — it's stable across versions and the IDE handles
serialization for you.

## 4. Verify

In a separate terminal:

```bash
acp-devtools ui
```

The UI opens in your browser. Now switch to the IDE, open the AI chat,
select your new agent from the model picker, and send any prompt
("ping"). Within a second the UI should show:

1. A new entry in the session picker (top right) — auto-discovered via
   `~/.acp-devtools/active/<pid>.json`.
2. The live timeline filling with `initialize`, `session/set_mode`,
   `session/set_model`, `session/prompt`, `session/update`, and so on.

If nothing shows up, run `acp-devtools doctor` for a diagnostic of your
local state and detected IDE config files.

## Troubleshooting

**"Agent server not starting" or "command failed".** Almost always a wrong
path. Verify `ls -l "$(which acp-devtools)"` returns a file. If it's a
`npm link` symlink, confirm the target still exists.

**"Authentication required" in the captured trace.** Claude Code's ACP
wrapper looks for credentials in `$CLAUDE_CONFIG_DIR` (default `~/.claude`).
Either authenticate that profile (`claude /login` after pointing
`CLAUDE_CONFIG_DIR`) or set `ANTHROPIC_API_KEY` in the Environment field of
the agent server entry.

**WebStorm sends `session/set_mode` and `session/set_model` on every prompt,
flooding the UI.** That's WebStorm's actual behaviour, not a bug. ACP Devtools
hides them by default through the "Boilerplate" filter chip — toggle it back
on if you want to see them.

**Multiple JetBrains IDEs at once.** Each IDE chat session creates a separate
proxy on its own ephemeral port; they all show up in the UI's session picker
simultaneously, labelled with the agent command.

# ACP Devtools

A transparent stdio proxy between your editor and an ACP coding agent that
captures every JSON-RPC frame, stores sessions in SQLite, and streams them to
a local web inspector. Wireshark, scoped to AI coding agents.

> **Status (2026-05-26):** installs from source today. v0.1.0 ships to npm
> soon; the source flow below produces the exact same `acp-devtools` binary.

## What is ACP?

The [Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)
is an open, newline-delimited JSON-RPC wire format that lets an editor (Zed,
WebStorm, IntelliJ, Neovim, Visual Studio via ReSharper) drive a coding agent
(Claude Code, Codex, Goose, OpenCode, and [30+ others](https://agentclientprotocol.com/get-started/agents))
without either side knowing the implementation of the other. Editors spawn
the agent as a subprocess and talk over stdio. ACP Devtools sits in the middle
of that stdio pipe.

## When you'd reach for it

- Your Claude Code session feels slow. ACP Devtools tells you the p99 of
  `session/prompt` is 25s and one call took 60s — and lets you read its
  payload.
- You're building an ACP agent or an IDE plugin and need to see what the
  *other* side actually sends. WebStorm and Zed disagree on capabilities,
  meta, and id format; the inspector shows you exactly what.
- You hit a bug in yesterday's chat. Open the saved session from
  `~/.acp-devtools/captures.db`, scrub the replay at 4× speed, and step
  through to the failing tool call.
- You're trying to figure out why an agent makes a specific tool call —
  inspect the full `session/prompt` payload, every tool invocation, and the
  agent's reasoning chunks in `session/update` notifications.

## What you'll see

The inspector is a Wireshark-style timeline plus a JSON detail panel.
Captured frames stream in live; clicking one expands its payload.

```
 ◢◣◢◣ acp.devtools  v0.1.0   SESSION #21 · alive 12m · idle 4s    ● LIVE  ⌘K

[→ OUT] [← IN]    REQ  RSP  NTF  ERR  STR    □ hide set_mode/set_model

 001  19:01:08.646  → AGENT  REQ  initialize           id:1    861B
 002  19:01:09.519  ← AGENT  RSP  —                    id:1   1.3KB  +873ms
 003  19:01:09.527  → AGENT  REQ  session/new          id:2    159B
 004  19:01:10.503  ← AGENT  RSP  —                    id:2   2.6KB  +976ms
 005  19:01:10.504  ← AGENT  NTF  session/update              6.0KB
 006  19:01:13.721  → AGENT  REQ  session/prompt  "hi" id:3    188B
 ▎07  19:01:16.520  ← AGENT  STR  Hi! What would you like to   236ms
 ▎09                                work on?              3 chunks
 010  19:01:16.931  ← AGENT  RSP  —                    id:3     59B  +3.21s

 MSGS 13  REQ 3  RSP 3  NTF 7  ERR 0    P50 976MS  P99 3.21S
```

Top bar shows the live session and a picker for switching between concurrent
captures. Each row carries direction, kind (request / response /
notification / error / stream), method, the short rpc id, payload size, and
latency to the paired request. The detail panel (not shown) renders the full
JSON for any selected message in Tree / Raw / Meta tabs.

## Compared to existing ACP inspectors

There are two other public ACP inspector projects. They're worth knowing
about:

- **`tbrandenburg/acp-inspector`** (2⭐, planned but unreleased) — README
  outlines ambitious features; no working build exists yet as of mid-2026.
- **`venikman/ACP-inspector`** (9⭐, F# / .NET) — useful for .NET-stack
  agents specifically; less convenient for Node / TypeScript work.

ACP Devtools is the only Node-based option that ships today with proxy,
persistence, replay, and a live UI in one CLI.

---

## Quickstart

Two install paths. Install option A works today (from source). Install
option B will work after the v0.1.0 npm release.

### Install option A — from source (today)

```bash
git clone https://github.com/maksugr/acp-devtools.git
cd acp-devtools
npm install                     # also installs the pre-commit hook
npm run build:full              # builds core, cli, ui, embeds UI in cli dist

cd packages/cli && npm link     # exposes `acp-devtools` globally via symlink
which acp-devtools              # → varies by your Node install location
```

Requires Node 20+ and macOS / Linux / WSL. Build takes about ten seconds end
to end.

### Install option B — npx / global npm (after v0.1.0 publish)

```bash
# Zero-install — npx downloads acp-devtools on first run, then caches it
npx acp-devtools ui

# Or install globally if you need the absolute path (JetBrains in particular)
npm install -g acp-devtools
which acp-devtools
```

This block is intentionally future-tense; check the badge or the GitHub
releases page to know when it goes live.

### Verify the install

```bash
acp-devtools doctor
```

Prints Node version, the resolved absolute binary path (paste this into IDE
configs that need it), `~/.acp-devtools/` state, any live captures, and
detected IDE config files for Zed and JetBrains products. If something
later doesn't show up in the UI, `doctor` is the first place to look.

### Open the inspector

```bash
acp-devtools ui
# → http://127.0.0.1:3737/  (browser opens automatically)
```

The empty state has a tabbed snippet generator — pick **Zed** or
**JetBrains**, hit Copy. The absolute path of your binary is pre-filled.

### Connect Zed (the 3-line version)

Open `~/.config/zed/settings.json` (`Cmd+,` inside Zed) and merge in:

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

That's the whole config for the default Claude Code setup. `acp-devtools`
detects it was spawned by an IDE (stdin is a pipe, not a TTY) and runs
`proxy --agent claude-code` internally.

If Zed shows "agent command not found", replace `"acp-devtools"` with the
absolute path printed by `which acp-devtools` in your terminal. Zed's GUI
process on macOS inherits a minimal `PATH` that often misses Node-installed
binaries (especially under `nvm`). The path varies — Homebrew Node puts it
under `/opt/homebrew/bin/`, `nvm` under `~/.nvm/versions/node/<v>/bin/`,
system Node typically under `/usr/local/bin/`.

**If you ran `npx acp-devtools ui` without globally installing**, the bare
`"command": "acp-devtools"` above will not resolve — IDEs don't know about
npx's cache. Use the npx-aware variant instead:

```json
{
    "agent_servers": {
        "Claude Code (via ACP Devtools)": {
            "type": "custom",
            "command": "npx",
            "args": ["-y", "acp-devtools"]
        }
    }
}
```

JetBrains additionally needs the absolute path to npx itself
(`which npx`). For everyday use `npm install -g acp-devtools` is simpler —
no extra npx layer per spawn.

For multi-profile, JetBrains, Goose, or OpenCode setups, see the recipes:

- [Zed setup with every agent](examples/zed-config.md)
- [JetBrains setup (WebStorm / IntelliJ / PyCharm / …)](examples/jetbrains-config.md)
- [Claude Code multi-profile (personal vs work OAuth)](examples/claude-code-setup.md)

Send a prompt in your IDE chat → the proxy spawns the agent, writes a
discovery descriptor to `~/.acp-devtools/active/<pid>.json`, and the
inspector picks it up within 2.5s.

---

## CLI reference

One binary, four subcommands. Run any command with `--help` for full flag
listings — e.g. `acp-devtools proxy --help`, `acp-devtools ui --help`.

### `proxy [agent] [args…]`

Wraps an ACP agent in capture-everything mode. This is what IDE
`agent_servers` configs point at.

```bash
# Shortcut — known agent by name
acp-devtools proxy --agent claude-code
acp-devtools claude-code              # bare-shortcut form
acp-devtools                          # zero-arg form (when stdin is piped)

# Explicit — wrap any binary
acp-devtools proxy --save-to /tmp/session.db \
    npx -y @agentclientprotocol/claude-agent-acp
```

| Flag | Default | Meaning |
|---|---|---|
| `--agent <name>` | — | preset for a known agent (`claude-code`, `codex`, `goose`, `opencode`) |
| `--log <mode>` | `none` | per-message log to stderr (`json`, `pretty`, `none`) |
| `--cwd <dir>` | inherit | working directory for the agent process |
| `--save-to <file>` | `~/.acp-devtools/captures.db` | shared captures SQLite |
| `--no-save` | — | disable persistence entirely |
| `--session-name <name>` | — | human label stored with the session |
| `--ws-port <port>` | `0` | WebSocket port; `0` lets the OS pick an ephemeral one |
| `--ws-host <host>` | `127.0.0.1` | WebSocket bind address |
| `--no-ws` | — | disable the WebSocket server entirely |

### `replay <db>`

Streams a saved session to the inspector over WebSocket.

```bash
acp-devtools replay /tmp/session.db --ws-port 3737
```

Flags: `--session <id>` (default: latest), `--ws-port <port>`,
`--ws-host <host>`.

### `ui`

Serves the inspector UI from the bundle embedded in the CLI tarball.

```bash
acp-devtools ui --port 3737
```

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `3737` | HTTP port |
| `--host` | `127.0.0.1` | bind address |
| `--no-open` | — | suppress the browser auto-open |
| `--captures-db <file>` | `~/.acp-devtools/captures.db` | DB for `/api/sessions` and `/replay/<id>` |

The server exposes four endpoints: `GET /api/active` (live captures from
the discovery directory), `GET /api/sessions` (saved sessions in
captures.db), `GET /api/info` (binary path, used by the empty state to
pre-fill snippets), and `WS /replay/<id>` (stream a saved session).

### `doctor`

Diagnoses the local setup.

```bash
acp-devtools doctor          # human-readable
acp-devtools doctor --json   # for scripts and CI checks
```

Reports Node version, resolved binary path, the `~/.acp-devtools/` tree,
captures.db statistics, live captures, and detected IDE config files. Exit
code 1 if anything in the "fail" tier.

---

## Supported agents

The built-in registry covers four agents. npm-based agents auto-install on
first use through `npx -y …`. Binary-based agents require a one-time install
through their own channels.

| Shortcut | What it runs | Install |
|---|---|---|
| `claude-code` *(default)* | `npx -y @agentclientprotocol/claude-agent-acp` | npx — automatic |
| `codex` | `npx -y @zed-industries/codex-acp` | npx — automatic |
| `goose` | `goose acp` | install Goose from <https://goose-docs.ai> first |
| `opencode` | `opencode acp` | `curl -fsSL https://opencode.ai/install \| bash` |

For Cursor, GitHub Copilot, Cline, Junie, Qwen Code, Mistral Vibe, and 25+
others, see the full
[ACP agents directory](https://agentclientprotocol.com/get-started/agents)
and use the explicit form: `acp-devtools proxy <your-command> [args…]`.

Adding a new shortcut is one PR to
`packages/core/src/agents/registry.ts` — see *For contributors → adding an
agent shortcut* below.

---

## Architecture

```
   Editor (Zed / JetBrains / Neovim / VS via ReSharper)
            │  ACP via stdio (newline-delimited JSON-RPC 2.0)
            ▼
   ┌─────────────────────────────────────────┐
   │  acp-devtools proxy                      │
   │   spawns the agent                       │
   │   captures every frame in both directions│
   │   writes ~/.acp-devtools/captures.db     │
   │   broadcasts on a local WebSocket        │
   │   registers ~/.acp-devtools/active/      │
   └──────────────┬──────────────────────────┘
                  │ stdio
                  ▼
        ACP agent (claude-agent-acp, codex-acp, …)


   Browser ◄── HTTP ──── acp-devtools ui (3737)
                          serves the React bundle
                          /api/active, /api/sessions, /api/info, /replay/<id>
                          discovers live captures, attaches to their WS
```

Neither side of the pipe knows the proxy exists. Multiple captures (e.g. one
chat per IDE window) coexist on independent ephemeral ports and all appear
in the inspector's session picker.

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ACP_DEVTOOLS_HOME` | `~/.acp-devtools` | root dir for captures.db, `active/`, future per-host state |

---

## For contributors

```bash
npm test               # vitest run — 270+ tests across core + ui
npm run lint           # eslint
npm run typecheck      # tsc --noEmit on core + cli + ui
npm run format         # prettier --write
npm run precommit      # lint + typecheck + test (~3s, also the git hook)
```

### UI hot-reload during development

```bash
# Generate a small mock capture (7 messages — 3 req / 3 rsp / 1 ntf)
npm run fixture:generate

# Terminal 1 — replay it over WS on port 3737
npm run dev:fixture

# Terminal 2 — Vite dev server with HMR on port 5173
npm run dev:ui

# Browser → http://127.0.0.1:5173/
```

`npm run dev:proxy -- <flags> <agent> <args…>` and
`npm run dev:replay -- <db> <flags>` are shortcuts that rebuild first. The
`--` separator is required by npm before flags that should pass through.

### Adding a new agent shortcut

1. Open `packages/core/src/agents/registry.ts`.
2. Add an entry:

   ```ts
   'your-shortname': {
       shortName: 'your-shortname',
       displayName: 'Your Agent',
       description: 'One-line description that shows up in `--agent` help',
       command: 'npx',                       // or a binary name on PATH
       args: ['-y', '@your-scope/your-acp'], // or ['acp']
       // requiresExternalInstall: true,      // if it's a binary, not an npm pkg
       // aliases: [['npx', '-y', 'old-name']], // for deprecated names
   },
   ```

3. Run `npm test` — the `captureLabel` tests cover registry-aware label
   detection; add a case there if you want extra coverage.
4. Update the table in this README's *Supported agents* section.
5. Open a PR.

### Layout

```
packages/
  core/    @acp-devtools/core   parser, proxy, storage, WS broadcaster,
                                 discovery, shared HTTP server, agents registry
  cli/     acp-devtools         commander CLI: proxy / replay / ui / doctor
  ui/      @acp-devtools/ui     Vite + React + Tailwind frontend

examples/                          IDE setup recipes (end-user docs)
  zed-config.md                    Zed agent_servers setup
  jetbrains-config.md              WebStorm / IntelliJ / PyCharm setup
  claude-code-setup.md             Claude Code multi-profile recipe

fixtures/                          dev/test data (contributor-only)
  mock-agent.js                    scripted ACP agent for tests
  sample-session.jsonl             3-request input fixture
  ws-client.js                     minimal WS subscriber for terminal debugging
  fixture.db                       generated by `npm run fixture:generate` (gitignored)
```

The CLI is bundled with **tsup** — `@acp-devtools/core` and `@acp-devtools/ui`
are private workspace packages that never reach npm. The published
`acp-devtools` tarball is exactly `dist/index.js` plus the embedded UI at
`dist/ui/`. Runtime deps from npm are `better-sqlite3`, `ws`, `commander`,
and `@agentclientprotocol/sdk`.

### Pre-commit hook

`simple-git-hooks` is wired in via the root `prepare` script, so a fresh
`npm install` registers it. The hook runs `npm run precommit`. To skip it
on a single commit (genuine emergencies only):
`SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

---

## Roadmap

After v0.1.0 ships, in rough priority order:

1. **`acp-devtools` as MCP server.** A built-in MCP server that exposes
   captures.db over MCP tools (`list_sessions`, `search_messages`,
   `get_latency_stats`, …). Closes the loop: debug Claude with Claude.
2. **`acp-devtools install <ide>`.** Patches Zed / JetBrains settings
   automatically with a sensible agent_servers entry. Backup before write.
3. **Schema validation against the ACP spec.** Spec violations get badges in
   the inspector; perfect quality-bar tool for agent maintainers.
4. **Performance dashboard.** Per-method p50 / p99 / max latency tables and
   payload-size histograms, with `--group-by client_name` so you can see how
   the same agent behaves under different IDEs.
5. **Session info panel.** Surface every piece of metadata the editor and
   agent already send during `initialize` — client / agent versions,
   capability matrix, current mode and model, JetBrains-specific
   `_meta.proxyConfig`.
6. **Plugin system.** Per-agent renderers — pretty Edit/Bash views for
   Claude Code, MCP-aware decoding, redactors for cloud sharing.
7. **Homebrew tap.** Single-command install for non-Node users
   (`brew install acp-devtools/tap/acp-devtools`).

---

## License

MIT — see [LICENSE](LICENSE).

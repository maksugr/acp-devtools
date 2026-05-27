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

### Labels you'll see

The session header (left of the picker) tells you **what** you're looking at;
the connection chip (right of the actions menu) tells you **how** it's being
delivered. Every label has a tooltip on hover.

| Header label | Meaning |
|---|---|
| `SESSION #N` | live capture — proxy is still running, frames are arriving |
| `REPLAY #N` | playback of a saved session from `captures.db` |
| `IMPORTED #N` | playback of a session that was loaded from a JSON file (the row has `imported_at` set in the database) |

| Connection chip | Meaning |
|---|---|
| `LIVE` | WebSocket attached to a running proxy; frames stream in real time |
| `REPLAY` | WebSocket serving a finished session from `captures.db` |
| `FILE` | viewing an imported session — the proxy is unrelated, nothing is reconnecting |
| `WAITING` | reconnect loop is trying to reach the WS, exponential backoff |
| `IDLE` | no capture selected (e.g. the proxy ended and replay finished) |
| `CLOSED` | server closed the socket; click the chip to retry |
| `ERROR` | the most recent connection attempt failed with the error in the tooltip |

| Row badge | Meaning |
|---|---|
| `REQ` | JSON-RPC request (expects a response) |
| `RSP` | JSON-RPC response (carries `result`) |
| `NTF` | JSON-RPC notification (one-way, no id) |
| `ERR` | error response (carries `error.code`/`error.message`) |
| `UNK` | the frame did not parse as JSON-RPC; raw bytes are still preserved |
| `STR` | collapsed run of consecutive `agent_message_chunk` notifications |
| `⚠ SPEC N` | the frame fails the official ACP schema with `N` ajv errors; click the row, then the **Spec** tab in the detail panel for the full list. The footer's `spec ⚠ N` chip aggregates across the session. |

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

One binary, fourteen subcommands. Every UI control has a CLI equivalent —
the inspector is one frontend among others, not a hard dependency. Run any
command with `--help` for the full flag listing.

| Group | Commands |
|---|---|
| **Capture** | `proxy` |
| **Inspect** | `ui`, `replay`, `inspect`, `search`, `stats`, `validate` |
| **Manage data** | `list`, `export`, `import`, `delete` |
| **Mock** | `mock-agent`, `mock-editor` |
| **Setup** | `doctor` |

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

### `replay [path]`

Streams a saved session to the inspector over WebSocket. Accepts either a
SQLite database from `--save-to` or a `.json` file produced by `export`
(auto-detected by extension). The path defaults to the shared
`~/.acp-devtools/captures.db`, so calling `replay` with no arguments
streams the latest live-captured session.

```bash
acp-devtools replay --ws-port 3737                        # default DB, latest
acp-devtools replay --session 21 --ws-port 3737           # default DB, specific session
acp-devtools replay /tmp/session.db --ws-port 3737        # custom DB
acp-devtools replay /tmp/capture.json --ws-port 3737      # JSON export from a teammate
```

Flags: `--session <id>` (SQLite only; default: latest), `--ws-port <port>`,
`--ws-host <host>`.

### `list`

Lists saved sessions in the database, newest first. Imported sessions are
sorted by when they were *imported*, not by their original capture time.

```bash
acp-devtools list                          # default db, 50 rows
acp-devtools list --imported               # only imported sessions
acp-devtools list --limit 5 --json         # machine-readable
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--limit <n>` | `50` | maximum rows |
| `--imported` | — | only imported sessions |
| `--saved` | — | only non-imported (live-captured) sessions |
| `--json` | — | emit JSON instead of an aligned table |

Sample output:

```
#25  20h3m  imported  5msg   acp-session-16-2026-05-27-...json
#23  50m    saved     20msg  WebStorm 2026.1.2 · npx -y @agentclientprotocol/claude-agent-acp
#22  56m    saved     0msg   npx -y @agentclientprotocol/claude-agent-acp
```

Live captures don't appear here — they're process descriptors, not database
rows. Use `acp-devtools doctor` to see them.

### `export [db]`

Writes one session as a self-contained JSON file — metadata plus every
captured frame, losslessly. Useful for attaching to GitHub issues, offline
analysis with `jq`, or building per-agent fixtures. `[db]` defaults to the
shared `~/.acp-devtools/captures.db`.

```bash
acp-devtools export                                  # latest session, JSON to stdout
acp-devtools export --session 21 -o capture.json     # specific session
acp-devtools export --session 21 > capture.json      # equivalent via shell redirect
acp-devtools export /tmp/session.db -o capture.json  # custom DB path
```

Flags: `--session <id>` (default: latest), `-o, --output <file>`,
`--no-pretty` (compact one-line JSON for diff / grep).

### `import <file>`

Inserts a JSON export into the database as a new saved session, with
`imported_at = now()`. The new id is printed to stdout (so it works in a
shell pipeline); the human-readable status line goes to stderr.

```bash
acp-devtools import capture.json
# stderr: acp-devtools: imported capture.json → session #29 (12 messages)
# stdout: 29

id=$(acp-devtools import capture.json --quiet)
acp-devtools list --json | jq ".[] | select(.id == $id)"
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to write to |
| `--quiet` | — | suppress the stderr status line |

### `delete <id…>`

Removes one or more sessions from the database forever; the schema cascades
to their messages. No interactive prompt — pair with `acp-devtools list`
first if you want to verify ids.

```bash
acp-devtools delete 27                      # one session
acp-devtools delete 25 26 27                # several at once
acp-devtools delete --db /tmp/other.db 5
```

Exit codes: `0` if every id was deleted, `1` if any id was missing, `2`
for malformed input.

### `inspect <id>`

Prints messages of a saved session to stdout — the terminal equivalent of
the inspector timeline. Three output formats and the same filter axes as
the UI's FilterBar.

```bash
# Plain table (default), 500 rows max
acp-devtools inspect 23 --limit 20

# Only requests, outgoing direction, scrolled to seq 50+
acp-devtools inspect 23 --kind req --dir out --from-seq 50

# Substring grep on the raw frame, like Cmd+F in the UI
acp-devtools inspect 23 --grep session/prompt

# JSON Lines — pipe to jq for arbitrary analysis
acp-devtools inspect 23 --format jsonl | jq -r 'select(.method == "session/prompt") | .raw'

# Just the raw frames — replay-friendly
acp-devtools inspect 23 --format raw > rerun-input.jsonl
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--limit <n>` | `500` | max messages to print |
| `--from-seq <n>` | — | start from this seq (inclusive) |
| `--dir <codes>` | both | direction filter: `out`, `in`, `out,in` |
| `--kind <codes>` | all | kind filter: comma-separated subset of `req,rsp,ntf,err,unk` |
| `--method <pattern>` | — | substring match on method name (case-insensitive) |
| `--grep <text>` | — | substring match on the raw frame (case-insensitive) |
| `--paired` | — | only req/rsp/err — skip notifications |
| `--no-preview` | — | omit the PREVIEW column (useful on narrow terminals or for grep) |
| `--spec` | — | add a SPEC column showing schema-validation status (`✓` / `⚠N` / blank for skipped) |
| `-f, --format <mode>` | `table` | `table` (default), `jsonl` (CapturedMessage per line), `raw` (just the wire frames) |

Sample table output:

```
  1  12:09:29.339  →A  REQ  initialize     1  →2   935ms  861B
  2  12:09:30.274  A←  RSP  —              1  ←1   935ms  1.6KB
  3  12:09:30.377  →A  REQ  session/new    2  →4   1.25s  289B
  5  12:09:31.626  A←  NTF  session/update —  —        —  6.0KB
 13  12:09:32.316  →A  REQ  session/prompt 6  →20  5.04s  309B  "fix the bug in foo.ts"
 14  12:09:37.045  A←  NTF  session/update —  —        —  174B  "Looking at the file…"
```

Columns: seq · time (UTC HH:MM:SS.mmm) · direction (`→A` editor-to-agent
or `A←` agent-to-editor) · kind · method · rpc_id · pair (`→N` request
points at response seq N; `←N` response points back at request seq N) ·
latency (request↔response wall-clock) · frame size · preview (extracted
text for `session/prompt` and agent reply chunks). Notifications without
text content and orphan responses leave pair/latency/preview empty. Parse
failures land in the METHOD column as `! <error message>`.

The pair index is computed across the **whole session**, not just the
filtered subset — so `--kind req` still shows the latency on each
request, even though the matching responses are hidden.

### `search <query>`

Full-text substring search across every saved session — the cross-session
equivalent of the UI search box. Case-insensitive.

```bash
acp-devtools search session/prompt                # everywhere
acp-devtools search "Edit" --session 23           # only session #23
acp-devtools search prompt --in-method            # match method names only
acp-devtools search initialize --json | jq        # programmatic
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to search |
| `--limit <n>` | `50` | maximum hits |
| `--session <id>` | — | restrict to one session |
| `--in-method` | — | match method names only |
| `--in-payload` | — | match inside the frame body only |
| `--json` | — | machine-readable JSON instead of a table |

Sample output:

```
#23/13   session/prompt  …est","id":6,"method":"session/prompt","params":{"sessionId":"9b…
#23/15   session/update  …{"name":"init","description":"Initialize a new CLAUDE.md…
```

Columns: `#session/seq` · method · snippet (with `…` around the hit).

### `stats <id>`

Aggregates a saved session — the terminal equivalent of the inspector's
footer StatsBar. Totals per direction and kind, plus p50 / p90 / p99 / max
/ mean latency over request↔response pairs. Add `--by-method` for a
per-method breakdown.

```bash
acp-devtools stats 23
acp-devtools stats 23 --by-method
acp-devtools stats 23 --json | jq '.latency.p99'
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--by-method` | — | append per-method table (method · count · p50 · p99 · total) |
| `--json` | — | machine-readable JSON instead of human-readable text |

Sample output:

```
session #23  ·  1h14m ago  ·  lasted 2m37s  ·  WebStorm 2026.1.2 · Claude Code

DIRECTION          COUNT
→ editor → agent   6
← agent → editor   14

KIND   COUNT
REQ    6
RSP    6
NTF    8
ERR    0

LATENCY (response pairs · 6 samples)
p50    470ms
p90    3.15s
p99    4.85s
max    5.04s
mean   1.21s
```

The percentile algorithm matches the UI StatsBar (linear interpolation),
so the inspector and CLI agree to the millisecond on the same data.

### `validate <id>`

Checks every frame in a session against the official ACP JSON schema
shipped in `@agentclientprotocol/sdk` (Draft 2020-12, ajv). Surfaces
violations as a flat table — useful when you suspect an editor or agent
you don't control is sending malformed traffic.

```bash
# Default: validate session #23 in the shared captures.db
acp-devtools validate 23

# Only complain about a specific method
acp-devtools validate 23 --method session/prompt

# CI-friendly JSON output, exit 1 on any violation
acp-devtools validate 23 --json
```

Sample output for a corrupted session:

```
session #31 · 7 checked · 0 skipped (no schema) · 2 violations in 2 methods

 #1  initialize      InitializeRequest  /     must have required property 'protocolVersion'
 #3  session/prompt  PromptRequest      /     must have required property 'prompt'
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--limit <n>` | `200` | maximum violations to print |
| `--method <pattern>` | — | only report messages whose method contains this substring |
| `--json` | — | machine-readable JSON (CI / scripts) |

Exit code is `1` whenever at least one violation is found, `0` on clean
sessions — drop into a CI step to gate releases.

Frames are skipped (counted but not flagged) when:
- the message itself failed to parse (already surfaced as `! <error>` in `inspect`);
- the method isn't in the spec at all (extension methods, future API additions);
- the spec has no schema for the kind (e.g. JSON-RPC error envelopes — those are framing, not ACP-specific).

The same check runs as part of `inspect --spec` (per-row `✓` / `⚠N`
column) and `stats` (summary line) — see those sections.

**In the inspector UI, the same data shows up in three places:**

- **Timeline row badge** — a red `⚠ SPEC N` chip appears next to the
  method name on every invalid frame. `N` is the number of ajv errors on
  that frame; the tooltip lists the first few.
- **Detail panel — `Spec` tab.** Click a row, switch to the **Spec** tab
  (rightmost). For invalid frames you get a card per ajv error with the
  keyword (`required`/`type`/`enum`), JSON-pointer path, and message. For
  valid frames you see the matched `$def` (e.g. `InitializeRequest`). For
  frames that can't be validated (parse error, unknown method, response
  without paired request) the tab explains why instead of faking a green
  tick.
- **Footer chip** — `spec ⚠ N` next to `p50`/`p99` shows how many frames
  in the visible session are non-conforming (or `spec ✓` when clean). The
  tooltip lists the affected method names.

### The inspector's equivalents

The picker hides a `×` trash on each saved-session row that maps to `delete
<id>`. The `[⋯]` menu in the top bar exposes `import`, `export`, and
`clear`. Imported sessions sit under their own **IMPORTED** section in the
picker; the mode label in the top bar flips from `REPLAY` to `IMPORTED`
and the connection chip from `LIVE` to `FILE` so you always know whether
the data on screen came from a process, the database, or a file you just
opened.

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

The server exposes six endpoints: `GET /api/active` (live captures from
the discovery directory), `GET /api/sessions` (saved sessions in
captures.db), `POST /api/import` (insert a JSON export as a new session,
sets `imported_at`; the inspector's `[⋯] → import` action uses this),
`DELETE /api/sessions/<id>` (remove a session and cascade-delete its
messages), `GET /api/info` (binary path, used by the empty state to
pre-fill snippets), and `WS /replay/<id>` (stream a saved session).

### Headless workflow (no browser)

Every inspector action is a CLI invocation. A typical no-UI loop:

```bash
# 1. Capture a session (IDE talks to acp-devtools instead of the agent).
#    Sessions are auto-saved to ~/.acp-devtools/captures.db; each gets a
#    globally unique id.
#    (Wire it up in your IDE per the Quickstart, then have a chat.)

# 2. See what's there.
acp-devtools list --limit 10

# 3. Inspect a specific session offline — dump it as JSON, query with jq.
acp-devtools export --session 23 -o /tmp/s23.json
jq '.messages | map(select(.method == "session/prompt")) | length' /tmp/s23.json
# → 4

# 4. Inspect a session in the terminal — same filters as the UI FilterBar.
acp-devtools inspect 23 --kind req --method session/prompt
acp-devtools inspect 23 --format jsonl | jq 'select(.method == "fs/read_text_file")'

# 5. Search across every saved session for a pattern.
acp-devtools search session/cancel --limit 10

# 6. Share a session with a teammate.
acp-devtools export --session 23 -o capture.json
# email / Slack / gist / GitHub-issue-attach the resulting JSON

# 7. Receive someone's capture — load it into your own database.
id=$(acp-devtools import their-capture.json --quiet)
acp-devtools list --imported

# 8. Clean up.
acp-devtools delete 17 18 19
```

For interactive inspection without a browser the inspector still helps —
`acp-devtools ui` serves a local-only web UI on `127.0.0.1` that you can
point any browser at. But nothing requires it: `list` / `export` / `jq` /
`sqlite3 ~/.acp-devtools/captures.db` is enough for most debugging.

### `mock-agent [--session N | --script FILE]`

Pretends to be an ACP agent by replaying a previously-recorded session.
Reads JSON-RPC frames from stdin (a real editor or a pipe of recorded
frames), writes recorded agent responses to stdout. Response `id`s are
patched to match whatever id the live editor actually sent.

Reads directly from `~/.acp-devtools/captures.db` by default — no need to
`export` first. Use `--session N` to pick a specific row, `--script FILE`
to load a teammate's JSON export instead.

**When you'd use it:**

- **Building an IDE plugin.** You're writing an ACP client for VS Code,
  Sublime, your custom editor. Every test against the real Claude Code
  costs tokens and waits on the network. Wire your editor at mock-agent
  → instant, free, deterministic responses for every dev cycle.
- **CI for the editor side.** Record one good session, replay it in CI
  on every PR to confirm your plugin still parses agent responses
  correctly — no API key required, no flakiness.
- **Offline / conference demos.** Run the inspector and your editor
  side-by-side on stage with no network. mock-agent plays back recorded
  conversations on cue.
- **Reproducing a user-reported bug.** User attaches their `capture.json`
  to an issue. Wire mock-agent at that file → your editor walks through
  the exact same conversation that triggered the bug, locally.
- **Comparing IDE behaviours.** Same script, two IDEs: see who handles
  edge cases like `_meta.proxyConfig` or interleaved notifications
  correctly.

**How to run:**

```bash
# Pipe-test without an IDE (verifies mock emits exactly what was recorded):
acp-devtools inspect 23 --dir out --format raw --no-preview > /tmp/editor.jsonl
acp-devtools mock-agent --session 23 < /tmp/editor.jsonl > /tmp/got.jsonl
diff /tmp/got.jsonl <(acp-devtools inspect 23 --dir in --format raw --no-preview)
# → no diff: mock emitted exactly the recorded agent side
```

To use as a real IDE agent, point your `agent_servers` at it (Zed example,
JetBrains is analogous):

```jsonc
{
    "agent_servers": {
        "MockAgent": {
            "type": "custom",
            "command": "acp-devtools",
            "args": ["mock-agent", "--session", "23"]
        }
    }
}
```

| Flag | Default | Meaning |
|---|---|---|
| `--session <id>` | — | session id in `--db` (default: latest) |
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--script <file>` | — | JSON export from `acp-devtools export`; mutually exclusive with `--session` (use when somebody hands you a JSON file outside your DB) |
| `--log <mode>` | `none` | echo every wire frame to stderr (`json`, `pretty`, `none`) |
| `--realtime` | — | respect the recording's timestamps so playback feels live (good for demos; off by default for CI speed) |
| `--save-to <file>` | — | persist the editor↔mock conversation to a SQLite DB; visible in `acp-devtools list` afterwards |
| `--session-name <name>` | — | label stored with the saved session |

Limitations (v1 record-replay only): strict in-order playback. If the
real editor sends frames in a different order than the recording, the
mock breaks. Response ids are substituted with the wire's actual id;
notifications carry no id and need no patching. For conditional matching
(regex on method, multiple responses per request), see plan.md item #1
"YAML DSL" — deferred until there's a concrete use case.

### `mock-editor [--session N | --script FILE] <agent> [args…]`

Pretends to be an editor by replaying the editor side of a recorded
session against a real (or fixture) ACP agent. Spawns the agent as a
child process, feeds it the scripted requests in order, captures its
responses. No IDE required.

Reads directly from `~/.acp-devtools/captures.db` by default. Use
`--session N` for a specific row or `--script FILE` for a JSON export.

**When you'd use it:**

- **Building your own ACP agent.** You're writing a Goose-like agent.
  Want to verify it speaks the protocol correctly without firing up
  Zed / WebStorm every time. Record once against a known-good reference,
  replay editor side against your code → fast feedback loop, no GUI in
  the loop.
- **Regression testing.** Record a baseline session against agent v1.
  When you ship v2, replay the same editor side through `mock-editor
  --save-to /tmp/v2.db your-agent-v2`. Export both, `diff` — anything
  that changed surfaces as a delta. Catches behavioural regressions
  before the user sees them.
- **CI integration tests.** Drop a few canonical `*.json` recordings into
  your repo. On every PR, run `mock-editor` against each. Fail the build
  if `stats --json` diverges (latency p99 doubled, error count went up).
- **Backward-compat checks.** Replay an old client's traffic (e.g. a
  recording from protocolVersion=1) against a new agent → confirms the
  agent still handles legacy editors.
- **Bug repro for the agent side.** A user reports a crash with a weird
  prompt shape. They send you their `capture.json`. Replay through your
  agent locally, attach a debugger.

**How to run:**

```bash
# Quick smoke — replay the latest captured session against a fixture agent
acp-devtools mock-editor --log pretty node fixtures/mock-agent.js

# Replay a specific session
acp-devtools mock-editor --session 23 your-agent

# Regression flow — baseline vs new build, captured to a separate DB
acp-devtools mock-editor --session 23 \
    --save-to /tmp/v2.db --session-name v2-regression \
    /path/to/your-agent-v2

# Compare what changed
acp-devtools export --session 23 -o /tmp/baseline.json
acp-devtools export /tmp/v2.db -o /tmp/v2.json
diff <(jq -S '.messages | map({direction, kind, method})' /tmp/baseline.json) \
     <(jq -S '.messages | map({direction, kind, method})' /tmp/v2.json)
```

| Flag | Default | Meaning |
|---|---|---|
| `--session <id>` | — | session id in `--db` (default: latest) |
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--script <file>` | — | JSON export from `acp-devtools export`; mutually exclusive with `--session` |
| `--cwd <dir>` | inherit | working directory for the agent process |
| `--log <mode>` | `none` | echo every wire frame to stderr (`json`, `pretty`, `none`) |
| `--realtime` | — | respect the recording's timestamps (otherwise replay is instant) |
| `--save-to <file>` | — | persist the mock↔agent conversation to a SQLite DB for later inspect / diff |
| `--session-name <name>` | — | label stored with the saved session |

The agent inherits the current environment; pass anything special via the
shell (`FOO=bar acp-devtools mock-editor …`). Signals (SIGINT, SIGTERM)
are forwarded to the child agent.

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

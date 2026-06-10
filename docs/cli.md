# CLI reference

Every UI control has a CLI equivalent — the inspector is one frontend among others, not a hard dependency. Run any command with `--help` for the colorized, grouped flag listing.

| Group | Commands |
|---|---|
| **Capture** | `proxy`, `mock-agent`, `mock-editor` |
| **Inspect** | `list`, `inspect`, `search`, `stats`, `diff`, `session-info`, `validate` |
| **View** | `ui`, `replay` |
| **Manage** | `export`, `import`, `delete`, `backfill-metadata` |
| **Setup** | `doctor`, `mcp` |

The inspector and MCP server have their own docs: [UI guide](ui.md) ·
[MCP server](mcp.md). Scenario-driven walkthroughs (headless debugging, A/B
two agents, mock-based CI) live in [recipes](recipes.md).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ACP_DEVTOOLS_HOME` | `~/.acp-devtools` | root dir for `captures.db`, `active/`, future per-host state |

---

## `proxy [agent] [args…]`

Wraps an ACP agent in capture-everything mode. This is what editor
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

## `replay [id]`

Streams a saved session to the inspector over WebSocket. The positional
argument is a **session id** (default: latest); pass `--file` to replay a
`.json` export from a teammate instead of a stored session.

```bash
acp-devtools replay --ws-port 3737                           # latest session
acp-devtools replay 21 --ws-port 3737                        # specific session
acp-devtools replay 5 --db /tmp/session.db --ws-port 3737    # session 5 in a custom DB
acp-devtools replay --file /tmp/capture.json --ws-port 3737  # a JSON export
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--file <path>` | — | replay a JSON export instead of a stored session |
| `--ws-port <port>` | `3737` | WebSocket port |
| `--ws-host <host>` | `127.0.0.1` | WebSocket bind address |

## `list`

Lists saved sessions in the database, newest first. Imported sessions are
sorted by when they were *imported*, not by their original capture time.

```bash
acp-devtools list                          # default db, 50 rows
acp-devtools list --imported               # only imported sessions
acp-devtools list --client WebStorm        # filter by client name/version/platform
acp-devtools list --limit 5 --json         # machine-readable
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--limit <n>` | `50` | maximum rows, counted AFTER filters — `--imported --limit 5` returns the 5 newest imported sessions |
| `--imported` | — | only imported sessions (mutually exclusive with `--saved` — together they exit `2`) |
| `--saved` | — | only non-imported (live-captured) sessions |
| `--client <s>` | — | case-insensitive substring match on `client_name`/`client_version`/`client_platform` |
| `--json` | — | emit JSON instead of an aligned table |

Sample output (colorized on a TTY — `#id` cyan, `saved` green / `imported`
amber; plain when piped or under `NO_COLOR`):

```
ID   AGE    KIND      MSGS  SESSION
#25  20h3m  imported     5  acp-session-16-2026-05-27-...json
#23  50m    saved       20  WebStorm 2026.1.2 · npx -y @agentclientprotocol/claude-agent-acp
#22  56m    saved        0  npx -y @agentclientprotocol/claude-agent-acp
```

Live captures don't appear here — they're process descriptors, not database
rows. Use `acp-devtools doctor` to see them.

## `inspect <id>`

Prints messages of a saved session to stdout — the terminal equivalent of the
inspector timeline. Three output formats and the same filter axes as the UI's
FilterBar.

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
| `-f, --format <mode>` | `table` | `table`, `jsonl` (CapturedMessage per line), `raw` (just the wire frames) |

Sample table output (colorized on a TTY):

```
  1  12:09:29.339  →A  REQ  initialize     1  →2   935ms  861B
  2  12:09:30.274  A←  RSP  —              1  ←1   935ms  1.6KB
  3  12:09:30.377  →A  REQ  session/new    2  →4   1.25s  289B
  5  12:09:31.626  A←  NTF  session/update —  —        —  6.0KB
 13  12:09:32.316  →A  REQ  session/prompt 6  →20  5.04s  309B  "fix the bug in foo.ts"
 14  12:09:37.045  A←  NTF  session/update —  —        —  174B  "Looking at the file…"
```

Columns: seq · time (UTC HH:MM:SS.mmm) · direction (`→A` editor-to-agent or
`A←` agent-to-editor) · kind · method · rpc_id · pair (`→N` request points at
response seq N; `←N` response points back at request seq N) · latency
(request↔response wall-clock) · frame size · preview (extracted text for
`session/prompt` and agent reply chunks). Notifications without text content
and orphan responses leave pair/latency/preview empty. Parse failures land in
the METHOD column as `! <error message>`.

The pair index is computed across the **whole session**, not just the filtered
subset — so `--kind req` still shows the latency on each request, even though
the matching responses are hidden.

## `search <query>`

Full-text substring search across every saved session — the cross-session
equivalent of the UI search box. Case-insensitive; the matched substring is
highlighted in the snippet on a TTY.

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

```
LOC      METHOD          MATCH
#23/13   session/prompt  …est","id":6,"method":"session/prompt","params":{"sessionId":"9b…
#23/15   session/update  …{"name":"init","description":"Initialize a new CLAUDE.md…
```

Columns: `#session/seq` · method · snippet (with `…` around the hit). Exit code
is grep-style: `0` when there is at least one hit, `1` when nothing matched —
so `acp-devtools search foo && …` branches correctly.

## `stats <id>`

Aggregates a saved session — the terminal equivalent of the inspector's footer
StatsBar. Totals per direction and kind, plus p50 / p90 / p99 / max / mean
latency over request↔response pairs, a spec-conformance line, and
auto-detected insights. Add `--by-method` for a per-method breakdown.

```bash
acp-devtools stats 23
acp-devtools stats 23 --by-method
acp-devtools stats 23 --json | jq '.latency.p99'
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--by-method` | — | append per-method table (method · count · p50 · p99 · total · ASCII latency distribution) |
| `--json` | — | machine-readable JSON instead of human-readable text |

Sample output (section labels and latency tones are colorized on a TTY; plain
when piped or under `NO_COLOR`):

```
session #23  ·  1h14m ago  ·  lasted 2m37s  ·  WebStorm 2026.1.2 · Claude Code

DIRECTION
→ editor → agent   6
← agent → editor   14

KIND
REQ    6
RSP    6
NTF    8
ERR    0

SPEC
20 frames checked · all conform

LATENCY (response pairs · 6 samples)
p50    470ms
p90    3.15s
p99    4.85s
max    5.04s
mean   1.21s

INSIGHTS
  !  HOTSPOT    session/prompt consumed 39.1s of total wall time
                    93% of 42.2s sampled latency
  #  BUSIEST    session/update sent 75 notifications
```

With `--by-method` you also get a per-method table that ends in an ASCII
sparkline column showing each method's latency distribution (`▁▂▃▄▅▆▇█`,
sorted ascending). At a glance you can tell a uniformly fast method (`██`) from
a long-tail one (`▁▁▁▁█` — one outlier dominating). The percentile algorithm
matches the UI StatsBar (linear interpolation), so the inspector and CLI agree
to the millisecond on the same data. The inspector adds a waterfall canvas on
top of the same numbers — see the [UI guide](ui.md#performance-dashboard).

## `diff <a> <b>`

Aligns two saved sessions and reports what changed across **three layers** —
the "worked yesterday, broke today" and A/B-the-same-prompt command. `a` is the
baseline (left), `b` is the new side (right):

1. **`INFO`** — metadata differences: client/agent identity, capability
   matrices, protocol version, runtime mode/model. (JetBrains `proxyConfig` is
   excluded as volatile.)
2. **`PERF`** — per-method latency, A vs B, with the p99 delta.
3. **`FRAMES`** — frame-level alignment via an LCS over `(direction, kind,
   method)` (responses align by their paired request's method); matched frames
   compared field-by-field on the payload, volatile `id` ignored.

INFO and PERF are aggregates, so — unlike the frame layer — they stay
high-signal even when per-run values (`sessionId`, `proxy_key`) churn. Start
there when comparing similar sessions.

```bash
acp-devtools diff 23 41                 # info + perf + collapsed frame diff
acp-devtools diff 23 41 --full          # show unchanged frames too
acp-devtools diff 23 41 --json | jq '.metadata, .perf, .summary'
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--full` | — | print unchanged frames too (default collapses equal runs) |
| `--json` | — | machine-readable JSON (`metadata` + `perf` + `summary` + `rows`) |
| `--raw` | off (redacts) | keep auth headers and proxy tokens in printed values — use only when the output stays on YOUR machine |

Auth headers and proxy tokens are redacted by default, before alignment —
same rules as [`export`](#export-id). That kills two birds: nothing live
lands in a copy-pasted diff, and two rotated tokens both become
`<REDACTED>`, so per-run token churn no longer shows up as a `≠` frame.
A summary goes to stderr: `redacted N field(s) across M message(s) —
re-run with --raw to compare live values`.

Sample output:

```
diff  #23  →  #41
  A #23  WebStorm 2026.1.2 · Claude Code  (20 msgs)
  B #41  Zed · Claude Code  (22 msgs)

INFO
  ~ agent.name: "@zed-industries/claude-code-acp" → "claude-agent-acp"
  ~ agentCapabilities.loadSession: true → false
  ~ client.platform: "intellij" → null

PERF  (p99 latency, Δ = B − A, sorted by |Δ p99|)
METHOD          KIND  A p99  B p99   Δ p99  COUNT
session/prompt  req   4.85s  9.80s  +4.95s    6→6
initialize      req   1.37s  120ms  −1.25s    1→1

FRAMES
= 16 same   ≠ 2 differs   ◂ 0 only in A   ▸ 4 only in B

   … 5 unchanged …
≠ →A REQ session/prompt   a#6  b#6
      ~ params.cwd: "/proj/a" → "/proj/b"
      + params._meta.profile: "fast"
   … 9 unchanged …
▸ A← NTF session/update   a#—  b#19
```

Markers use set-membership, not code-diff vocabulary — these are two
independent sessions, so a frame is *only in A* or *only in B*, never
"added"/"removed": `=` same · `≠` differs (each field change indented below,
where `~`/`+`/`-` are genuine key edits within that one payload) · `◂` only in
A · `▸` only in B. The inspector exposes the same three layers as Frames · Info
· Perf tabs — see the [UI guide](ui.md#diff-panel). The `diff_sessions`
[MCP tool](mcp.md) returns all three layers as structured data.

For when the diff is sharp and when it produces noise, see
[recipes → diffing sessions](recipes.md#diffing-sessions).

## `session-info <id>`

Prints derived client/agent metadata for a saved session — the terminal
equivalent of the inspector's session info panel. Useful when triaging
"WebStorm doesn't get file diffs" (`fs.writeTextFile` not advertised) or
comparing capability matrices across clients without opening the UI.

```bash
acp-devtools session-info 23
acp-devtools session-info 23 --json | jq '.metadata.clientCapabilities'
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--json` | — | machine-readable JSON instead of human-readable text |
| `--raw` | off (redacts) | keep auth headers and proxy tokens (the JetBrains `proxyConfig` gateway token prints as `<REDACTED>` by default) |

Sample output for a WebStorm capture:

```
SESSION #23
────────────────────────────────────────────────
  Client             WebStorm 2026.1.2 (intellij)
  Agent              @agentclientprotocol/claude-agent-acp v0.37.0
  Protocol           ACP v1
  Started            2026-05-27T12:09:29.336Z → 2026-05-27T14:15:28.551Z
  Messages           20

CLIENT CAPABILITIES
  fs.readTextFile    ✓
  fs.writeTextFile   ✓
  terminal           —
  auth.terminal      —
  auth.gateway       ✓

AGENT CAPABILITIES
  prompt             ✓
  loadSession        ✓
  auth methods       4

RUNTIME STATE
  current mode       default
  current model      —
  available cmds     debug, compact, init, …

JETBRAINS EXTENSIONS
  proxyConfig        {"proxies":[{"apiType":{"provider":"openai"}, …}]}
```

## `validate <id>`

Checks every frame in a session against the official ACP JSON schema shipped in
`@agentclientprotocol/sdk` (Draft 2020-12, ajv). Surfaces violations as a flat
table — useful when you suspect an editor or agent you don't control is sending
malformed traffic.

```bash
acp-devtools validate 23                          # whole session
acp-devtools validate 23 --method session/prompt  # one method
acp-devtools validate 23 --json                   # CI-friendly, exit 1 on any violation
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--limit <n>` | `200` | maximum violations to print |
| `--method <pattern>` | — | only report messages whose method contains this substring |
| `--json` | — | machine-readable JSON (CI / scripts) |

Sample output for a corrupted session:

```
session #31 · 7 checked · 0 skipped (no schema) · 2 violations in 2 methods

 #1  initialize      InitializeRequest  /     must have required property 'protocolVersion'
 #3  session/prompt  PromptRequest      /     must have required property 'prompt'
```

Exit code is `1` whenever at least one violation is found, `0` on clean
sessions — drop into a CI step to gate releases. Frames are skipped (counted
but not flagged) when the message failed to parse, the method isn't in the spec
(extension methods, future additions), or the spec has no schema for the kind
(JSON-RPC error envelopes are framing, not ACP-specific).

The same check runs as part of `inspect --spec` (per-row `✓` / `⚠N`) and
`stats` (summary line). In the inspector the same data shows up as timeline
badges, a detail-panel **Spec** tab, and a footer chip — see the
[UI guide](ui.md#spec-validation).

## `ui`

Serves the inspector UI from the bundle embedded in the CLI tarball. See the
[UI guide](ui.md) for what's inside.

```bash
acp-devtools ui --port 3737
```

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `3737` | HTTP port |
| `--host` | `127.0.0.1` | bind address |
| `--no-open` | — | suppress the browser auto-open |
| `--captures-db <file>` | `~/.acp-devtools/captures.db` | DB for `/api/sessions` and `/replay/<id>` |

## `export [id]`

Writes one session as a self-contained JSON file — metadata plus every captured
frame. Useful for attaching to GitHub issues, offline analysis with `jq`, or
building per-agent fixtures.

**Auth headers / proxy tokens are redacted by default.** WebStorm sessions
carry `_meta.proxyConfig.proxies[].proxy.headers.proxy_key` (JetBrains AI
gateway token) on every `initialize`; without redaction those would land in
every shared export. Standard HTTP auth headers (`Authorization`,
`Proxy-Authorization`, `X-Api-Key`, `X-Api-Token`, `Cookie`) are also masked
anywhere they appear. A short summary goes to stderr: `redacted N field(s)
across M message(s) — re-run with --raw to keep them`.

What the default does NOT redact: file contents loaded via
`fs/read_text_file`, prompts, and agent responses — those are user content
and only you can judge whether they're shareable. Audit with
`acp-devtools inspect <id>` first.

```bash
acp-devtools export                                  # latest session, JSON to stdout (redacted)
acp-devtools export 21 -o capture.json               # specific session
acp-devtools export 21 > capture.json                # equivalent via shell redirect
acp-devtools export 5 --db /tmp/session.db -o c.json # session 5 from a custom DB
acp-devtools export 21 --raw                         # keep all secrets (self-debug only)
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `-o, --output <file>` | stdout | write JSON to a file |
| `--no-pretty` | — | compact one-line JSON (diff / grep friendly) |
| `--raw` | off (redacts) | keep auth headers and proxy tokens — use only when the export stays on YOUR machine |

## `import <file>`

Inserts a JSON export into the database as a new saved session, with
`imported_at = now()`. The new id is printed to stdout (so it works in a shell
pipeline); the human-readable status line goes to stderr.

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

## `delete <id…>`

Removes one or more sessions from the database forever; the schema cascades to
their messages. No interactive prompt — pair with `acp-devtools list` first if
you want to verify ids.

```bash
acp-devtools delete 27                      # one session
acp-devtools delete 25 26 27                # several at once
acp-devtools delete --db /tmp/other.db 5
```

Exit codes: `0` if every id was deleted, `1` if any id was missing, `2` for
malformed input.

## `mock-agent [--session N | --script FILE]`

Pretends to be an ACP agent by replaying a previously-recorded session. Reads
JSON-RPC frames from stdin (a real editor or a pipe of recorded frames), writes
recorded agent responses to stdout. Response `id`s are patched to match
whatever id the live editor actually sent. Reads directly from
`~/.acp-devtools/captures.db` by default — no `export` first.

Use cases (editor-plugin dev, editor-side CI, offline demos, bug repro) and
end-to-end examples are in [recipes → mock the agent](recipes.md#mock-the-agent).

```bash
# Pipe-test without an editor (verifies mock emits exactly what was recorded):
acp-devtools inspect 23 --dir out --format raw --no-preview > /tmp/editor.jsonl
acp-devtools mock-agent --session 23 < /tmp/editor.jsonl > /tmp/got.jsonl
diff /tmp/got.jsonl <(acp-devtools inspect 23 --dir in --format raw --no-preview)
# → no diff: mock emitted exactly the recorded agent side
```

To use as a real editor agent, point your `agent_servers` at it:

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
| `--session <id>` | latest | session id in `--db` |
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--script <file>` | — | JSON export; mutually exclusive with `--session` |
| `--log <mode>` | `none` | echo every wire frame to stderr (`json`, `pretty`, `none`) |
| `--realtime` | — | respect the recording's timestamps (good for demos; off for CI speed) |
| `--save-to <file>` | — | persist the editor↔mock conversation to a SQLite DB |
| `--session-name <name>` | — | label stored with the saved session |

Limitations (v1 record-replay only): strict in-order playback. If the real
editor sends frames in a different order than the recording, the mock breaks.
Response ids are substituted with the wire's actual id; notifications carry no
id and need no patching.

## `mock-editor [--session N | --script FILE] <agent> [args…]`

Pretends to be an editor by replaying the editor side of a recorded session
against a real (or fixture) ACP agent. Spawns the agent as a child process,
feeds it the scripted requests in order, captures its responses. No editor
required. Reads from `~/.acp-devtools/captures.db` by default.

Use cases (building your own agent, regression testing, CI, backward-compat,
bug repro) are in [recipes → mock the editor](recipes.md#mock-the-editor).

```bash
# Quick smoke — replay the latest captured session against the stub agent
# that ships in the repo (needs a checkout)
acp-devtools mock-editor --log pretty node fixtures/mock-agent.js

# Replay a specific session against your agent
acp-devtools mock-editor --session 23 your-agent

# Regression flow — baseline vs new build, captured to a separate DB
acp-devtools mock-editor --session 23 \
    --save-to /tmp/v2.db --session-name v2-regression \
    /path/to/your-agent-v2
```

| Flag | Default | Meaning |
|---|---|---|
| `--session <id>` | latest | session id in `--db` |
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--script <file>` | — | JSON export; mutually exclusive with `--session` |
| `--cwd <dir>` | inherit | working directory for the agent process |
| `--log <mode>` | `none` | echo every wire frame to stderr (`json`, `pretty`, `none`) |
| `--realtime` | — | respect the recording's timestamps (otherwise replay is instant) |
| `--save-to <file>` | — | persist the mock↔agent conversation for later inspect / diff |
| `--session-name <name>` | — | label stored with the saved session |

The agent inherits the current environment; pass anything special via the shell
(`FOO=bar acp-devtools mock-editor …`). Signals (SIGINT, SIGTERM) are forwarded
to the child agent.

## `doctor`

Diagnoses the local setup.

```bash
acp-devtools doctor          # human-readable
acp-devtools doctor --json   # for scripts and CI checks
```

Reports Node version, resolved binary path (paste this into editor configs that
need it), the `~/.acp-devtools/` tree, captures-database statistics, live
captures, and detected editor config files for Zed and JetBrains products. Exit
code `1` if anything is in the "fail" tier. If something doesn't show up in the
UI, `doctor` is the first place to look.

## `mcp`

Runs a Model Context Protocol server over stdio that exposes saved captures as
**read-only** tools, so you can debug your ACP traffic by asking Claude. Full
setup, the eleven tools, and example prompts are in the
[MCP server guide](mcp.md).

```bash
acp-devtools mcp                          # serve over stdio
acp-devtools mcp --db /tmp/session.db     # alternative database
acp-devtools mcp --name acp-prod          # custom server name
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read |
| `--name <name>` | `acp-devtools` | server name advertised in MCP handshake |

## `backfill-metadata [id]`

Recomputes structured session metadata (client version, platform, agent name,
agent version, protocol version, current mode/model) for saved sessions by
re-scanning their `messages` table with the same extractor the live proxy uses.
Pure data layer — the capture database is the only input and output.

```bash
acp-devtools backfill-metadata             # all sessions
acp-devtools backfill-metadata 23          # single session
acp-devtools backfill-metadata --json      # for scripts
```

| Flag | Default | Meaning |
|---|---|---|
| `--db <path>` | `~/.acp-devtools/captures.db` | which database to read/write |
| `--json` | — | machine-readable JSON instead of text table |

When to run it: after `import`-ing JSON sessions from another machine (the proxy
never observed those messages, so its live-detection path didn't fire), or
after a schema upgrade that added columns old rows arrive with as NULL. Live
captures and CLI-saved sessions don't need it — the proxy populates the columns
as `initialize` flows through.

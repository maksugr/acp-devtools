# The inspector (UI)

A local-only web inspector for captured ACP traffic. Start it with
`acp-devtools ui` (opens `http://127.0.0.1:3737/`). It serves a vertical
timeline of every frame plus a JSON detail panel; frames stream in live, and
clicking a row expands its payload on the right.

The top bar shows the live session and a picker for switching between
concurrent captures. Each row carries direction, kind, method, the short rpc
id, payload size, and latency to the paired request. The footer StatsBar
mirrors `acp-devtools stats`.

## Labels

The session header (left of the picker) tells you **what** you're looking at;
the connection chip (right of the actions menu) tells you **how** it's being
delivered. Every label has a tooltip on hover.

| Header label | Meaning |
|---|---|
| `SESSION #N` | live capture — proxy is still running, frames are arriving |
| `REPLAY #N` | playback of a saved session from the database |
| `IMPORTED #N` | playback of a session loaded from a JSON file (`imported_at` is set) |

| Connection chip | Meaning |
|---|---|
| `LIVE` | WebSocket attached to a running proxy; frames stream in real time |
| `REPLAY` | WebSocket serving a finished session from the database |
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
| `⚠ SPEC N` | the frame fails the official ACP schema with `N` ajv errors (see [Spec validation](#spec-validation)) |

## Timeline

- **Direction strip** colors each row by `→ OUT` (editor→agent) / `← IN`
  (agent→editor).
- **Stream clusters** — consecutive `agent_message_chunk` notifications collapse
  into one `STR` row with a chunk count and a shimmer bar while still streaming.
- **Latency annotations** — responses show `+Nms`/`+Ns` since their paired
  request, tone-colored fast→slow.
- **Sticky-bottom scroll** keeps the newest frame in view during a live
  capture; scroll up to pause autoscroll.
- **FilterBar** — direction chips (`→ OUT` / `← IN`), kind chips
  (REQ / RSP / NTF / ERR), a `stream` toggle that collapses
  `agent_message_chunk` runs into one row, and a payload search box. Every
  filter has a CLI equivalent on `acp-devtools inspect`.

## Detail panel

Selecting a row renders its full JSON-RPC frame in three tabs:

- **Tree** — expandable, type-colored JSON with vertical guides. It is
  **spec-aware**: when the method maps to a known ACP request/response/
  notification, the top shows the schema-def name (e.g. `ACP TYPE
  InitializeRequest`) and a one-line description. Each field carries a ⓘ hover
  tooltip from the schema, and a `⚠ ext` badge marks anything under `_meta` or
  fields not declared in the spec — handy for spotting editor-specific
  extensions.
- **Raw** — the verbatim wire frame.
- **Meta** — capture metadata (seq, timestamps, direction, sizes).
- **Spec** — schema-validation result for the frame (see below).

## Spec validation

The same check behind `acp-devtools validate` surfaces in three places:

- **Timeline badge** — a red `⚠ SPEC N` chip next to the method on every
  invalid frame. `N` is the ajv error count; the tooltip lists the first few.
- **Detail → Spec tab** — for invalid frames, a card per ajv error with the
  keyword (`required`/`type`/`enum`), JSON-pointer path, and message. For valid
  frames, the matched `$def` (e.g. `InitializeRequest`). For frames that can't
  be validated (parse error, unknown method, response without a paired request)
  the tab explains why instead of faking a green tick.
- **Footer chip** — `spec ⚠ N` next to `p50`/`p99` aggregates non-conforming
  frames across the visible session (or `spec ✓` when clean); the tooltip lists
  affected methods.

## Performance dashboard

The TopBar `perf` button opens a full-screen view:

- **Per-method table** — sortable by method · kind · count · p50 · p99 · max ·
  total, each row ending in a sparkline of the latency distribution.
- **INSIGHTS callout** — auto-detected hotspot / long-tail / outlier / busiest /
  error methods.
- **Waterfall canvas** — each request drawn as a horizontal bar over wall-clock
  time, with lanes for editor→agent / agent→editor / notifications and errored
  pairs tinted red. Idle stretches over 30s compress to a fixed `"X min idle"`
  marker so multi-hour sessions stay readable. Drag to pan; `Cmd/Ctrl + wheel`
  (or the `+` / `−` / `reset` buttons) to zoom; click any rect to jump to that
  message in the timeline.

The CLI equivalent is `acp-devtools stats <id> --by-method`; the numbers match
to the millisecond (same percentile algorithm).

## Diff panel

The TopBar `diff` button compares two saved sessions across the same three
layers as `acp-devtools diff`, as **Frames · Info · Perf** tabs:

- **Frames** — two-column aligned view (A left, B right) with same / differs /
  only-in-A / only-in-B tinting and click-to-expand field-level changes.
- **Info** — the metadata change list.
- **Perf** — the per-method p99-delta table.

Both sides are dropdowns: A starts on the session you opened the diff from, and
either side is swappable (you can't pick the same session for both). For when
the diff is sharp vs noisy, see [recipes → diffing sessions](recipes.md#diffing-sessions).

## Session info panel

The TopBar `info` button shows derived client/agent metadata — versions,
capability matrix, runtime mode/model, available commands, and JetBrains
`_meta.proxyConfig`. Same data as `acp-devtools session-info <id>`.

## Replay controls

When viewing a saved session, a control bar offers play / pause / speed (1× /
2× / 4×) / seek, so you can scrub a recorded conversation and step to a specific
frame.

## Picker and data actions

The session picker groups live captures, saved sessions, and an **IMPORTED**
section. Each saved-session row has a `×` trash that maps to `delete <id>`. The
`[⋯]` menu exposes `import`, `export`, and `clear`. The mode label flips
`REPLAY` → `IMPORTED` and the chip `LIVE` → `FILE` so you always know whether
the data came from a process, the database, or a file you just opened.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `J` / `K` | next / previous frame |
| `Esc` | close the detail panel or an open drawer |
| `⌘K` / `Ctrl+K` | command palette |

Browser **Back** closes an open drawer (info / perf / diff) rather than leaving
the page.

## Server endpoints

`acp-devtools ui` serves the React bundle plus a small API:

| Endpoint | Purpose |
|---|---|
| `GET /api/active` | live captures from the discovery directory |
| `GET /api/sessions` | saved sessions in the database |
| `GET /api/sessions/:id/messages` | full frame list for one session (used by diff) |
| `GET /api/info` | binary path, used by the empty state to pre-fill snippets |
| `POST /api/import` | insert a JSON export as a new session (sets `imported_at`) |
| `DELETE /api/sessions/:id` | remove a session and cascade-delete its messages |
| `WS /replay/:id` | stream a saved session |

Everything binds to `127.0.0.1` by default, and every `/api/*` request plus
the replay WebSocket upgrade must carry a loopback `Host` header
(`127.0.0.1` / `localhost` / `[::1]`) — anything else gets `403`. That
closes the classic DNS-rebinding hole where a hostile page resolves its
own domain to `127.0.0.1` and reads the API from your browser. Two honest
caveats remain: the API has no authentication (any *local* process can
read it — same trust level as the database file itself), and
`/api/sessions/:id/messages` returns frames as captured, unredacted.
Binding a non-loopback address with `--host` extends the allowed `Host`
to that address; a wildcard bind (`0.0.0.0`) disables the check — only do
that on a network you trust.

# Anatomy of an ACP session

How to read a capture: which frames make up a healthy session, what the
common patterns mean, and where to look when something is off. Every example
below is real traffic — WebStorm 2026.1.2 talking to
`@agentclientprotocol/claude-agent-acp` 0.44.0 through the proxy — or a value
taken verbatim from the official ACP JSON schema. The [playground sample](https://playground.acp-devtools.dev/?url=https://gist.githubusercontent.com/maksugr/0059be3aba62538c099ae96f0bf34bbb/raw/06a5d8c926d6ad99a410688a07f8e35bd89bac36/gistfile1.txt)
is this exact capture (97 frames, auth tokens redacted) — open it and click
along; frame numbers below match it one-to-one.

## The whole session at a glance

Every session has the same skeleton: a handshake, a session setup, then a
loop of prompt turns. Everything else — file reads, permission dialogs,
terminals — happens *inside* a turn.

```
┌─ handshake ──────────────────────────────────────────────────┐
│ #1   → OUT  REQ  initialize                            id:1  │
│ #2   → OUT  REQ  initialize                            id:2  │
│ #3   ← IN   RSP  —                                   +7.23s  │
│ #4   ← IN   RSP  —                                   +7.23s  │
├─ session setup ──────────────────────────────────────────────┤
│ #5   → OUT  REQ  session/new                           id:3  │
│ #6   → OUT  REQ  session/new                           id:4  │
│ #7   ← IN   RSP  —                                   +2.54s  │
│ #8   ← IN   NTF  session/update ▸ available_commands_update  │
│ #9   ← IN   RSP  —                                   +2.69s  │
│ #10  ← IN   NTF  session/update ▸ available_commands_update  │
├─ editor housekeeping (×3, WebStorm) ─────────────────────────┤
│ #11  → OUT  REQ  session/set_config_option             id:5  │
│ #12  ← IN   NTF  session/update ▸ current_mode_update        │
│ #13  ← IN   RSP  —                                     +3ms  │
│ ...#14-#17: two more set_config_option round-trips...        │
├─ prompt turn ────────────────────────────────────────────────┤
│ #18  → OUT  REQ  session/prompt                        id:8  │
│ #19  ← IN   NTF  session/update ▸ usage_update               │
│ #20  ← IN   NTF  session/update ▸ agent_thought_chunk        │
│ ...#21-#26: message chunks and usage updates...              │
│ #27  ← IN   RSP  —  stopReason: end_turn             +7.47s  │
└──────────────────────────────────────────────────────────────┘
```

`→ OUT` is editor→agent, `← IN` is agent→editor — same labels as the
inspector timeline. KIND is the JSON-RPC frame type: `REQ` expects a
response, `RSP` answers it (paired by JSON-RPC `id`), `NTF` is
fire-and-forget. The inspector adds three more: `STR` for a collapsed run of
streaming chunks, `ERR` for an error response, `UNK` for a line that isn't
valid JSON-RPC (the last two are covered in
[What broken looks like](#what-broken-looks-like)). The latency annotation
on a response row counts from its paired request.

Yes, `initialize` and `session/new` really do appear twice — WebStorm runs
two parallel sessions over the one agent process it spawned. The chat you
type into is the one created by request `id:3`; the other session answers
setup and then stays idle for the rest of the capture. Note the responses
arrive out of order (`#7` answers `id:4`, `#9` answers `id:3`) — requests
and responses are matched by JSON-RPC `id`, never by arrival order. The
`+7.23s` on the handshake is a cold `npx` start downloading the agent
package; the same handshake answered in 660ms in a warm-start capture.

## 1. Handshake — `initialize`

The first frame is always `initialize`, and it decides everything that
follows. The editor sends its identity and capabilities:

```json
{
    "protocolVersion": 1,
    "clientInfo": {
        "name": "JetBrains.WebStorm",
        "title": "WebStorm 2026.1.2",
        "version": "2026.1.2",
        "_meta": { "platform": "intellij" }
    },
    "clientCapabilities": {
        "fs": { "readTextFile": true, "writeTextFile": true },
        "terminal": false,
        "auth": { "_meta": { "gateway": true } },
        "_meta": { "terminal-auth": true }
    }
}
```

The agent answers with its own identity (`agentInfo`), its capability set
(`loadSession`, `promptCapabilities`, `mcpCapabilities`, …), and the auth
methods it accepts:

```json
{
    "protocolVersion": 1,
    "agentInfo": {
        "name": "@agentclientprotocol/claude-agent-acp",
        "title": "Claude Agent",
        "version": "0.44.0"
    },
    "agentCapabilities": {
        "loadSession": true,
        "promptCapabilities": { "image": true, "embeddedContext": true },
        "mcpCapabilities": { "http": true, "sse": true }
    },
    "authMethods": [ { "id": "claude-ai-login", "name": "Claude Subscription", "…": "…" } ]
}
```

`protocolVersion` is a negotiation: the editor sends the
latest version it supports, and the agent must echo it back if compatible —
otherwise it answers with the latest version *it* supports, and an editor
that can't speak that version is expected to close the connection.
Capabilities are contracts for the rest of the session: an agent may only
call `fs/read_text_file` because the editor declared `fs` here —

```json
"clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true } }
```

— and an editor may only resume old chats because the agent declared
`loadSession`:

```json
"agentCapabilities": { "loadSession": true }
```

The same goes for prompt content — plain text always works, but images, audio, and
embedded resources each ride on a declared `promptCapabilities` flag. The
inspector's session-info drawer (and `acp-devtools session-info <id>`)
renders this exchange as a capability matrix.

Some editors attach private extensions under `_meta` — WebStorm puts its LLM
gateway config (including auth tokens) in `initialize._meta.proxyConfig`. The
spec allows that; the detail panel marks such fields with an `⚠ ext` badge,
and sharing surfaces redact the tokens
([Security & privacy](../README.md#security--privacy)).

If a session dies here, it usually dies loudly: no response to `initialize`
means the agent process never came up — run `acp-devtools doctor`, check the
agent's stderr.

Authentication has its own mini-anatomy. `initialize` succeeds even when the
agent isn't logged in — the response advertises the fix in `authMethods`.
claude-agent-acp 0.44.0 offers four:

```json
"authMethods": [
    { "id": "claude-ai-login", "name": "Claude Subscription", "type": "terminal", "…": "…" },
    { "id": "console-login", "name": "Anthropic Console", "type": "terminal", "…": "…" },
    { "id": "gateway", "name": "Custom model gateway", "…": "…" },
    { "id": "gateway-bedrock", "name": "Custom model gateway", "…": "…" }
]
```

When auth is missing, the operation that needs it fails with
`{"code": -32000, "message": "Authentication required"}`; the editor then
calls `authenticate` with a `methodId` — the schema requires it to be one of
the advertised ids — and retries. A capture from an already-logged-in setup
skips the `authenticate` call entirely, which is why it rarely appears in
real traffic. If you're staring at a `-32000`, the
[auth troubleshooting recipe](../examples/claude-code-setup.md#auth-troubleshooting)
walks through the fix.

## 2. Session setup — `session/new` or `session/load`

`session/new` carries the working directory and the editor's MCP server list:

```json
{
    "method": "session/new",
    "params": {
        "cwd": "/Users/Roman.Ponomarev/acp-devtools",
        "mcpServers": [],
        "_meta": { "additionalRoots": ["/Users/Roman.Ponomarev/Library/Caches/JetBrains/WebStorm2026.1/aia/agents"] }
    }
}
```

`mcpServers` is the editor handing its MCP servers over to the agent. Each
entry is a transport config: stdio (`command` + `args` — the one transport
every agent must support per the spec), or `http` / `sse`, allowed only when
the agent declared the matching `mcpCapabilities` flag in `initialize`.
WebStorm sends an empty list.

The response returns a `sessionId` (a UUID the rest of the session is keyed
on) plus the agent's modes and config options:

```json
{
    "sessionId": "0aa7d828-7e20-46dc-817e-70a051227b86",
    "modes": {
        "currentModeId": "default",
        "availableModes": [
            { "id": "auto", "name": "Auto", "description": "Use a model classifier to approve/deny permission prompts" },
            { "id": "default", "name": "Default", "description": "Standard behavior, prompts for dangerous operations" },
            { "id": "acceptEdits", "name": "Accept Edits", "description": "Auto-accept file edit operations" },
            { "id": "plan", "name": "Plan Mode", "description": "Planning mode, no actual tool execution" },
            { "id": "dontAsk", "name": "Don't Ask", "description": "Don't prompt for permissions, deny if not pre-approved" },
            { "id": "bypassPermissions", "name": "Bypass Permissions", "description": "Bypass all permission checks" }
        ]
    },
    "configOptions": [ { "id": "mode" }, { "id": "model" }, { "id": "effort" } ]
}
```

Six modes and three config options is claude-agent-acp 0.44.0; other agents
send fewer. Each config option carries its own typed `options` list —
`model`, for example, enumerates Opus / Sonnet / Haiku with descriptions.
Editors that restore an old
chat call `session/load` / `session/resume` with a stored `sessionId` instead
— that's why reopening a chat in WebStorm doesn't produce a fresh
`session/new`. On `session/load` the spec requires the agent to **replay the
entire conversation** as `session/update` notifications
(`user_message_chunk` / `agent_message_chunk`) — so a capture that starts
with a burst of history-looking chunks before any prompt is a resumed
session behaving correctly, not an echo bug.

Right after setup, `claude-agent-acp` pushes a
`session/update ▸ available_commands_update` notification with its full
slash-command list (agent behavior, not a spec requirement):

```json
{
    "sessionUpdate": "available_commands_update",
    "availableCommands": [
        { "name": "verify", "description": "Verify that a code change…", "input": null },
        { "name": "debug", "description": "Enable debug logging…", "input": { "hint": "[issue description]" } }
    ]
}
```

It looks like stream noise but it's session metadata — the session-info
drawer is where it lands. A command with a non-null `input.hint` takes
arguments; `input: null` means it's bare. Invoking a command later is plain
text in `session/prompt`
(`"/compact …"`); there is no separate command method on the wire.

## 3. Editor housekeeping

Editors differ in how chatty they are between turns, and the difference is
visible in every capture:

- WebStorm 2026.1.2 sends three `session/set_config_option` requests before
  **every** `session/prompt`, even when nothing changed (older builds sent a
  `session/set_mode` + `session/set_model` pair instead). Each round-trips in
  single-digit milliseconds:

  ```json
  {
      "method": "session/set_config_option",
      "params": { "sessionId": "0aa7d828-…", "configId": "mode", "value": "default" }
  }
  ```

  The other two set `model` and `effort` — the three config options from the
  `session/new` response, re-asserted verbatim.
- Zed sends none of this — `initialize`, `session/new`, then straight to
  prompts.

Neither behavior is a bug. The proxy records what's on the wire; expect the
boilerplate when reading a JetBrains capture.

## 4. The prompt turn

This is the core of the protocol — and the number-one source of confusion
when reading latency. `session/prompt` is a single long-lived request: the
response arrives only when the whole turn is finished. Everything the agent
does in between streams in as `session/update` notifications (and, for
anything that needs an answer, as agent→editor requests — next section).

The request itself is small — the user's message as an array of content
blocks (the `promptCapabilities` from the handshake decide which block types
are allowed), keyed to the session:

```json
{
    "method": "session/prompt",
    "params": {
        "sessionId": "0aa7d828-…",
        "prompt": [ { "type": "text", "text": "hi" } ],
        "_meta": { "additionalRoots": ["…"] }
    }
}
```

So in the overview above, the `+7.47s` on frame #27 is not "the agent was
slow to respond" — it's the duration of the entire turn: model thinking,
token streaming, tool calls. A 60s `session/prompt` with steady chunks in
between is a healthy long turn; the same 60s with no updates is an agent
that went silent.

The schema defines eleven `session/update` variants:

| `sessionUpdate` | What it carries |
|---|---|
| `agent_message_chunk` | the answer, token by token — the inspector collapses runs into one `STR` row |
| `agent_thought_chunk` | internal reasoning stream, same shape |
| `user_message_chunk` | the user's message streamed back (history replay on `session/load`) |
| `tool_call` | a tool call started |
| `tool_call_update` | tool-call status change: `pending` → `in_progress` → `completed` / `failed` |
| `plan` | the agent's task plan for multi-step work |
| `available_commands_update` | slash-command list ready or changed |
| `current_mode_update` | session mode switched |
| `config_option_update` | session config options changed |
| `session_info_update` | session metadata changed (title, …) |
| `usage_update` | token-usage counter (marked UNSTABLE in the spec) |

Three spec rules make these frames less confusing than they look:

- **`tool_call_update` is a patch.** Every field except `toolCallId` is
  optional, so an update carrying nothing but a new `status` is complete,
  not truncated. The initial `tool_call` also declares a `kind` (`read`,
  `edit`, `execute`, `search`, …), file `locations` the editor can
  follow along with, and `rawInput`/`rawOutput`.
- **`plan` always carries the whole plan.** The spec requires the full entry
  list in every update — near-identical plans repeating through a turn are
  correct behavior, not duplication.
- **`current_mode_update` arrives for *any* mode change — including the
  editor's own.** WebStorm's `session/set_config_option ▸ mode` gets a
  `current_mode_update` echoing the same mode before the response lands
  (frames #11-#13 in the overview). One *without* a nearby editor request is
  the agent switching modes on its own.

Here's the patch rule on the wire — frames #60-#66 of the playground sample.
#60 announces a `Write` before the agent knows what it will write:

```json
{
    "sessionUpdate": "tool_call",
    "toolCallId": "toolu_01KnuQ1ZHstRmHkVQGrBe8mF",
    "title": "Write",
    "kind": "edit",
    "status": "pending",
    "rawInput": {},
    "locations": [],
    "content": []
}
```

then #61 fills it in with a `tool_call_update` carrying the same
`toolCallId` — including a `diff` content block the editor can render:

```json
{
    "sessionUpdate": "tool_call_update",
    "toolCallId": "toolu_01KnuQ1ZHstRmHkVQGrBe8mF",
    "title": "Write NOTES.md",
    "kind": "edit",
    "rawInput": {
        "file_path": "/Users/Roman.Ponomarev/acp-devtools/NOTES.md",
        "content": "ACP Devtools captures every JSON-RPC frame…"
    },
    "content": [ { "type": "diff", "path": "…/NOTES.md", "oldText": null, "newText": "…" } ],
    "_meta": { "claudeCode": { "toolName": "Write" } }
}
```

An update carrying nothing but `toolCallId` and a new `status` would be just
as valid — every other field is optional. The `_meta.claudeCode` block is a
private extension (the detail panel badges it `⚠ ext`). What follows in the
capture: `session/request_permission` (#62) embeds this same `toolCallId` —
the permission dialog and the tool call that triggered it are linked on the
wire — and after the human clicks Allow, #66 closes the call with
`"status": "completed"`.

The turn ends with a response whose `stopReason` says why:

| `stopReason` | Meaning |
|---|---|
| `end_turn` | finished normally |
| `max_tokens` | hit the token ceiling |
| `max_turn_requests` | hit the per-turn request ceiling |
| `refusal` | agent refused to continue — the prompt won't be part of the next turn's context |
| `cancelled` | the editor sent `session/cancel` (see below) |

Agents that report usage attach it to the same response — the turn from
the overview ended with
`{"stopReason": "end_turn", "usage": {"inputTokens": 3688, "outputTokens": 44, "totalTokens": 37834, …}}`.

## 5. Mid-turn callbacks — the agent asks the editor

During a turn the arrow flips: the agent sends *requests* to the editor for
anything it can't do alone — `fs/read_text_file`, `fs/write_text_file`,
`session/request_permission`, `terminal/create` … `terminal/wait_for_exit`.
Here's a complete turn from the permission-flow demo fixture
(`acp-devtools inspect` output; seed it with `npm run fixtures:seed` in a
repo checkout):

```
SEQ  TIME          DIR  KIND  METHOD                      RPC  PAIR  LATENCY
  3  11:15:00.506  →A   REQ   session/prompt                2  →19     10.5s
  4  11:15:01.369  A←   NTF   session/update                —  —           —
  5  11:15:01.590  A←   REQ   fs/read_text_file             3  →6       14ms
  6  11:15:01.604  →A   RSP   —                             3  ←5       14ms
 10  11:15:02.287  A←   REQ   session/request_permission    5  →11     4.05s
 11  11:15:06.333  →A   RSP   —                             5  ←10     4.05s
 12  11:15:06.675  A←   REQ   fs/write_text_file            6  →13      58ms
 13  11:15:06.733  →A   RSP   —                             6  ←12      58ms
 17  11:15:10.613  A←   REQ   terminal/create               8  →18      57ms
 18  11:15:10.670  →A   RSP   —                             8  ←17      57ms
 19  11:15:10.964  A←   RSP   —                             2  ←3      10.5s
```

Read the latencies by who answers: `fs/*` and `terminal/*` are answered by
the editor process (14-58ms here — file IO), while
`session/request_permission` is answered by a *human* clicking a dialog
(4.05s). Permission latency is reaction time, not a performance problem —
the playground sample has the live equivalent at frame #62, where approving
the `Write NOTES.md` call from section 4 took the human 4.80s. In
the performance waterfall these callbacks get their own `agent-req` lane, so
a turn that spent 80% of its time waiting on a permission dialog is visible
at a glance.

Three more wire facts worth knowing when reading this section of a capture:

- **`fs/read_text_file` returns the editor's buffer, unsaved changes
  included** — that's the whole reason agents read through the editor
  instead of going to disk. Captured file content can legitimately differ
  from what `cat` shows.
- **Permission options are typed.** The request carries `options` with a
  `kind` each — `allow_once`, `allow_always`, `reject_once`,
  `reject_always` — and the response is `{"outcome": "selected",
  "optionId": …}` or `{"outcome": "cancelled"}`. An `allow_always` pick is
  why a capture can show one permission dialog followed by ten unprompted
  writes.
- **Terminals have a five-step lifecycle** — `terminal/create` returns an
  id immediately, `terminal/output` polls, `terminal/wait_for_exit` blocks
  until exit, `terminal/kill` stops the process, and the spec requires a
  final `terminal/release` for every terminal created. A tool call may
  embed `{"type": "terminal", "terminalId": …}` in its content: live
  command output streaming into the tool call, not a separate frame.

## 6. Cancellation

`session/cancel` is a notification — no id, no response of its own. The spec
is strict about what happens next: the in-flight `session/prompt` MUST still
resolve, with `stopReason: "cancelled"`, even if the cancellation blew up
tool calls underneath. The playground sample ends with exactly this — a
file-by-file repo walkthrough stopped mid-stream:

```
│ #95  → OUT  NTF  session/cancel                              │
│ #96  ← IN   NTF  session/update ▸ usage_update               │
│ #97  ← IN   RSP  —  stopReason: cancelled            +10.1s  │
```

Two readings worth pausing on. The `+10.1s` counts from the prompt (#83),
not from the cancel — the agent acknowledged the cancel in 8ms. And the
cancelled response still carries `usage`: a killed turn is a finished turn
as far as accounting goes.

Cancellation obliges both sides: the editor must answer any pending
`session/request_permission` with a `cancelled` outcome too — so a permission
request that resolves instantly right after a cancel is correct behavior, not
a phantom click.

A `session/cancel` followed by silence — the prompt request never resolves —
is an agent bug worth reporting.

## What broken looks like

| Timeline symptom | Likely cause |
|---|---|
| `UNK` row, parse error in the detail panel | the agent wrote a log line to stdout — stdout *is* the wire; logs belong on stderr |
| a `REQ` that never gets its `RSP` | agent hung or crashed mid-turn — check the frames just before the silence, then the agent's stderr |
| session is 2-4 frames, then nothing | agent died right after the handshake — auth failure or missing binary (`acp-devtools doctor`) |
| `ERR` rows | error responses — codes below |
| red `⚠ SPEC N` badge | the frame violates the ACP schema — `acp-devtools validate <id>` lists every violation |

Quirk or violation? The spec draws the line precisely: custom data belongs
in `_meta` (allowed on every type, from requests down to content blocks),
custom methods must start with `_`, and inventing root-level fields on spec
types is a MUST NOT. The inspector mirrors that line — `_meta` extensions
get an `⚠ ext` badge (information), root-level inventions get `⚠ SPEC` (a
bug on whichever side produced the frame). Two related non-bugs: a `-32601`
answer to a `_`-prefixed method is the prescribed response from a side that
doesn't implement that extension, and unrecognized extension notifications
are dropped silently by design.

Error codes the schema defines:

| Code | Meaning |
|---|---|
| `-32700` | parse error — invalid JSON on the wire |
| `-32600` | invalid request |
| `-32601` | method not found — one side called something the other doesn't implement |
| `-32602` | invalid params |
| `-32603` | internal error |
| `-32800` | request cancelled |
| `-32000` | authentication required |
| `-32002` | resource not found |
| `-32042` | URL elicitation required |

## Reading the numbers

Three rules keep latency stats honest:

1. **`session/prompt` latency = turn duration.** A `HOTSPOT` insight on
   `session/prompt` in `acp-devtools stats` is the expected shape of almost
   every session — the interesting question is what *inside* the turn took
   the time.
2. **Split callbacks by who answers.** `fs/*` and `terminal/*` measure the
   editor; `session/request_permission` measures the human. Only
   time-to-first-chunk and inter-chunk gaps measure the model and the
   network.
3. **Idle gaps are user behavior, not protocol behavior.** The waterfall
   compresses stretches over 30s into an `"X min idle"` marker so they don't
   drown the turns.

Where to look: `acp-devtools stats <id> --by-method` for percentiles and
insights, the perf drawer's waterfall for the time layout of a single turn,
`acp-devtools inspect <id> --paired` for per-request latencies in order.

## Where to go next

- [The inspector (UI)](ui.md) — every badge and panel mentioned above
- [CLI reference](cli.md) — `inspect`, `stats`, `validate`, `session-info`
- [Recipes](recipes.md) — triaging a slow session, validating an agent, CI gates
- [Official protocol docs](https://agentclientprotocol.com/protocol/overview) — the spec itself

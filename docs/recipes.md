# Recipes

## Headless debugging (no browser)

**For:** anyone who lives in a terminal, or CI. Every inspector action is a CLI
invocation; `list` / `export` / `jq` / `sqlite3 ~/.acp-devtools/captures.db` is
enough for most debugging.

```bash
# 1. Capture a session — wire your editor to acp-devtools (see the Quickstart),
#    then have a chat. Sessions auto-save to ~/.acp-devtools/captures.db,
#    each with a globally unique id.

# 2. See what's there.
acp-devtools list --limit 10

# 3. Dump a session as JSON and query it with jq.
acp-devtools export 23 -o /tmp/s23.json
jq '.messages | map(select(.method == "session/prompt")) | length' /tmp/s23.json

# 4. Inspect in the terminal — same filters as the UI FilterBar.
acp-devtools inspect 23 --kind req --method session/prompt
acp-devtools inspect 23 --format jsonl | jq 'select(.method == "fs/read_text_file")'

# 5. Search across every saved session.
acp-devtools search session/cancel --limit 10

# 6. Clean up.
acp-devtools delete 17 18 19
```

## Triaging a slow session

**For:** users whose agent feels sluggish.

```bash
acp-devtools stats 23 --by-method     # which method dominates p99 + INSIGHTS
acp-devtools inspect 23 --kind req --paired   # per-request latencies in order
```

The `HOTSPOT` insight tells you which method ate the wall-clock time; open that
session's [perf waterfall](ui.md#performance-dashboard) in the UI to see exactly
where the time went. The MCP tool `get_latency_stats` returns the same numbers
if you'd rather ask Agent.

## Validating a third-party agent or editor

**For:** agent/editor authors who want a conformance gate.

```bash
acp-devtools validate 23              # human-readable table
acp-devtools validate 23 --json       # exit 1 on any violation — drop into CI
```

Catches malformed traffic from a client or agent you don't control. Per-frame
detail also shows up in `inspect 23 --spec` and in the inspector's
[Spec tab](ui.md#spec-validation).

## Sharing a capture for a bug report

**For:** anyone filing or receiving an issue.

```bash
# Sender — export and attach the JSON (email / Slack / gist / GitHub issue).
acp-devtools export 23 -o capture.json

# Receiver — import it into your own database.
id=$(acp-devtools import their-capture.json --quiet)
acp-devtools list --imported
acp-devtools inspect "$id"
```

The export is self-contained and lossless: metadata plus every frame.

## Diffing sessions

**For:** "worked yesterday, broke today" and A/B comparisons.

```bash
acp-devtools diff 23 41                # info + perf + collapsed frame diff
acp-devtools diff 23 41 --full         # show unchanged frames too
```

The diff earns its keep when the two sessions are **supposed to be nearly
identical**, so the handful of `≠` / `▸` / `◂` rows are exactly what changed:

- **Worked yesterday, broke today.** Same editor, agent, prompt — diff
  yesterday's capture against today's. The non-`=` rows are the regression.
- **Regression via replay.** Record a baseline, re-run the same input through a
  new agent build with `mock-editor --save-to`, then diff baseline vs replay.
- **A/B two agents on one prompt.** Claude Code vs Goose on the same task — see
  where their wire behavior diverges (capabilities, extra notifications,
  `tool_call` shape).
- **Before/after an upgrade.** Capture the same actions before and after bumping
  the agent or editor; diff the handshake and capability negotiation.

It is **not** a "pick any two sessions and compare" browser. Two *different*
conversations naturally diverge — different prompts mean different tool calls and
frame counts, so you'll get mostly `+`/`-` noise. Feed it controlled pairs and
it's sharp; feed it unrelated sessions and it'll tell you they're unrelated.

## Mock the agent

Test the editor side. **For:** people building an editor, a plugin, or an ACP
client.

`mock-agent` replays a recorded agent so your editor gets instant,
deterministic, free responses — no tokens, no network.

- **Building an editor plugin.** Every test against the real agent costs tokens and
  waits on the network. Wire your editor at `mock-agent` → instant responses for
  every dev cycle.
- **Editor-side CI.** Record one good session, replay it on every PR to confirm
  your plugin still parses agent responses correctly — no API key, no flakiness.
- **Offline / conference demos.** Run the inspector and your editor side-by-side
  with no network; `--realtime` makes playback feel live.
- **Reproducing a user bug.** A user attaches their `capture.json`; wire
  `mock-agent --script` at it and your editor walks the exact conversation that
  triggered the bug, locally.

```bash
# Drive a real editor — point agent_servers at mock-agent (see CLI reference).
# Or pipe-test without an editor:
acp-devtools inspect 23 --dir out --format raw --no-preview > /tmp/editor.jsonl
acp-devtools mock-agent --session 23 < /tmp/editor.jsonl > /tmp/got.jsonl
diff /tmp/got.jsonl <(acp-devtools inspect 23 --dir in --format raw --no-preview)
# → no diff: mock emitted exactly the recorded agent side
```

## Mock the editor

Test the agent side. **For:** people building an ACP agent.

`mock-editor` replays the editor side of a recorded session against a real (or
fixture) agent — fast feedback with no GUI in the loop.

- **Building your own agent.** Verify it speaks the protocol without firing up
  Zed / JetBrains IDEs every time. Record once against a known-good reference, replay
  the editor side against your code.
- **Regression testing.** Record a baseline against v1; replay the same editor
  side through v2 with `--save-to`, export both, `diff` — behavioral regressions
  surface as deltas before the user sees them.
- **CI integration tests.** Drop canonical `*.json` recordings into your repo;
  on every PR replay each and fail if `stats --json` diverges (p99 doubled,
  error count up).
- **Backward-compat checks.** Replay an old client's traffic (e.g.
  protocolVersion=1) against a new agent to confirm it still handles legacy
  editors.

```bash
# Smoke against a fixture agent
acp-devtools mock-editor --log pretty node fixtures/mock-agent.js

# Regression: baseline vs new build
acp-devtools mock-editor --session 23 --save-to /tmp/v2.db your-agent-v2
acp-devtools export 23 -o /tmp/baseline.json
acp-devtools export --db /tmp/v2.db -o /tmp/v2.json
diff <(jq -S '.messages | map({direction, kind, method})' /tmp/baseline.json) \
     <(jq -S '.messages | map({direction, kind, method})' /tmp/v2.json)
```

## Gate a build in CI

**For:** agent / editor authors who want to fail a pull request on a spec
violation or a latency regression — headless, no browser, no API key.

Ship a recorded golden session in the repo
(`acp-devtools export <id> -o fixtures/golden.json`), then replay it through the
build and check the result. Every step is exit-code-driven:

```yaml
- name: Replay a golden session through the agent
  run: acp-devtools mock-editor --script fixtures/golden.json --save-to run.db ./your-agent

- name: Resolve the captured session id
  run: echo "SID=$(acp-devtools list --db run.db --limit 1 --json | jq '.[0].id')" >> "$GITHUB_ENV"

- name: Fail on any ACP spec violation
  run: acp-devtools validate "$SID" --db run.db --json   # exit 1 when non-conformant

- name: Fail on a latency regression (p99 budget 5s)
  run: acp-devtools stats "$SID" --db run.db --json | jq -e '.latency.p99 < 5000'
```

`jq -e` exits non-zero when the test is false (or the field is null), so the
step — and the build — fails when p99 blows the budget. To gate against a
baseline run instead of a fixed number, capture both and assert on the `perf`
deltas from `acp-devtools diff <baseline> <new> --json`.

Same primitives the inspector uses, driven by exit codes.

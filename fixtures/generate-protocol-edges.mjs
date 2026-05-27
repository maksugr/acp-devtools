#!/usr/bin/env node
// Synthesises a session full of *envelope-level* edge cases — not schema
// violations (those go in `broken-session`), but malformed JSON-RPC and
// orphan request/response pairs. Useful for stress-testing:
//
// - the `parseError` field path in the inspector (raw frame shown verbatim
//   in DetailPanel's Tree tab, "parse error" badge in MessageRow)
// - `buildPairIndex` robustness against orphans (a request with no
//   response, a response with no matching request)
// - `extractSessionMetadata` degradation when `initialize` itself errors
//   out (SessionInfoPanel should render gracefully)
// - timeline waterfall when an event has no `endTs` partner
//
//   node fixtures/generate-protocol-edges.mjs --out /tmp/edges.json
//   acp-devtools import /tmp/edges.json
import { writeFileSync } from 'node:fs';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;

const startedAt = Date.UTC(2026, 4, 27, 17, 30, 0, 0);
let ts = startedAt;
let seq = 0;
const messages = [];
const sessionId = '0eed7bdc-edges';

function pushParsed(direction, kind, payload, method) {
    seq += 1;
    const frame = {
        seq,
        timestamp: ts,
        direction,
        kind,
        raw: JSON.stringify(payload),
        payload,
    };
    if (method) frame.method = method;
    if (payload && payload.id !== undefined && payload.id !== null) {
        frame.rpcId = payload.id;
    }
    messages.push(frame);
}

function pushRaw(direction, raw, parseError) {
    // Frame that failed to parse — payload is null, parseError set, raw
    // carries the offending bytes. The proxy emits these when the agent
    // produces malformed output mid-stream.
    seq += 1;
    messages.push({
        seq,
        timestamp: ts,
        direction,
        kind: 'unknown',
        raw,
        payload: null,
        parseError,
    });
}

function advance(min, max) {
    ts += min + Math.floor(Math.random() * (max - min));
}

// ── 1. Failed initialize — agent errors out on the handshake ───────────
// Verifies SessionInfoPanel + extractSessionMetadata handle a session
// that never got a clean InitializeResponse (no clientInfo / no
// agentCapabilities to report).
pushParsed('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: 1,
        clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    },
}, 'initialize');
advance(80, 200);
pushParsed('agent-to-editor', 'error', {
    jsonrpc: '2.0',
    id: 1,
    error: {
        code: -32000,
        message: 'agent boot failed: missing ANTHROPIC_API_KEY',
        data: { env: 'ANTHROPIC_API_KEY', stage: 'initialize' },
    },
});
advance(2_000, 3_000);

// ── 2. Orphan REQUEST — no response ever arrives ───────────────────────
// `buildPairIndex` should not crash; the timeline rect stays at zero
// width (endTs == startTs). Common in real life when an agent hangs
// before the request times out client-side.
pushParsed('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: {},
}, 'session/new');
advance(500, 1000);

// ── 3. Malformed JSON frame from the agent (real parse error) ──────────
// The proxy emits this with `parseError` set and payload=null. The
// inspector's DetailPanel Tree tab should fall back to showing the raw
// bytes instead of crashing.
pushRaw(
    'agent-to-editor',
    '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"oops, broken json,}',
    'Unexpected end of JSON input',
);
advance(300, 600);

// ── 4. Trailing-comma + comment — invalid JSON, common LLM output bug ──
pushRaw(
    'agent-to-editor',
    '{\n    "jsonrpc": "2.0",  // some agents like to comment\n    "method": "session/update",\n    "params": {"x": 1,},\n}',
    'Unexpected token / in JSON at position 30',
);
advance(200, 400);

// ── 5. Orphan RESPONSE — no matching request ───────────────────────────
// Tests pair-index resilience: a response whose `id` doesn't match any
// in-flight request (could happen after a clear, or with buggy agents).
pushParsed('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: 9999,
    result: { totallyOrphan: true },
});
advance(400, 800);

// ── 6. Notification with completely broken envelope (real parse error) ─
pushRaw(
    'agent-to-editor',
    '{"jsonrpc":"2.0",,,"method":"session/update"}',
    'Unexpected token , in JSON at position 17',
);
advance(300, 600);

// ── 7. A clean session/new request — but the response uses a different `id` ─
// Spec violation in form, but parses fine. Pair index should not match
// these as a pair.
pushParsed('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 3,
    method: 'session/new',
    params: {},
}, 'session/new');
advance(60, 120);
pushParsed('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: 88, // mismatched on purpose — shouldn't pair with seq 3
    result: { sessionId },
});
advance(700, 1100);

// ── 8. A notification with missing `params` (envelope OK, content empty) ─
pushParsed('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    // params missing entirely
}, 'session/update');
advance(200, 400);

// ── 9. Empty-string raw (zero-byte frame slipped through) ──────────────
pushRaw('editor-to-agent', '', 'Unexpected end of JSON input');
advance(500, 800);

// ── 10. A clean back-and-forth to anchor expectations ──────────────────
pushParsed('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 4,
    method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text: 'one that works' }] },
}, 'session/prompt');
advance(900, 1400);
pushParsed('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'OK.' } } },
}, 'session/update');
advance(200, 400);
pushParsed('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: 4,
    result: { stopReason: 'end_turn' },
});

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-protocol-edges', version: '1.0.0' },
    session: {
        id: 0,
        name: 'protocol-edges-fixture',
        agentCommand: 'npx -y @agentclientprotocol/claude-agent-acp',
        clientName: 'Zed',
        startedAt,
        endedAt,
    },
    messages,
};

const json = JSON.stringify(exportPayload, null, 2);
if (OUT_PATH) {
    writeFileSync(OUT_PATH, json);
    const parseErrs = messages.filter((m) => m.parseError).length;
    const orphans = messages.filter(
        (m) =>
            (m.kind === 'request' && !messages.some(
                (r) => r.rpcId === m.rpcId && r.kind !== 'request' && r.seq > m.seq,
            )) ||
            (m.kind === 'response' && !messages.some(
                (r) => r.rpcId === m.rpcId && r.kind === 'request',
            )),
    ).length;
    process.stderr.write(
        `wrote ${messages.length} messages (${parseErrs} parseError frames, ~${orphans} orphans) → ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
}

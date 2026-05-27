#!/usr/bin/env node
// Synthesises a session full of errors of various flavours — auth failures,
// timeouts, internal errors, schema-rejection from agent side. Useful for
// stress-testing the ERRORS insight, the red-tinted error rects in the
// timeline waterfall, and the error-row colouring in the inspector.
//
//   node fixtures/generate-error-storm.mjs --out /tmp/errors.json
//   acp-devtools import /tmp/errors.json
import { writeFileSync } from 'node:fs';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;

const startedAt = Date.UTC(2026, 4, 26, 10, 30, 0, 0);
let ts = startedAt;
let seq = 0;
let rpcId = 0;
const messages = [];
const sessionId = '0eed7bdc-error-storm';

function push(direction, kind, payload, method) {
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
    ts += 40 + Math.floor(Math.random() * 200);
}

function advance(ms) {
    ts += ms;
}

// Clean preamble.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'JetBrains.WebStorm', title: 'WebStorm 2026.1.2', version: '2026.1.2' },
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        },
    }, 'initialize');
    push('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: {
            protocolVersion: 1,
            agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
            agentCapabilities: { loadSession: true },
            authMethods: [],
        },
    });
}
advance(500);

// Error 1 — JSON-RPC -32603 Internal error.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/new',
        params: {},
    }, 'session/new');
    advance(2_300);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'agent crashed during session/new — see stderr' },
    });
}
advance(800);

// Error 2 — authentication failure (custom code 1001).
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'authenticate',
        params: { method: 'oauth' },
    }, 'authenticate');
    advance(600);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: {
            code: 1001,
            message: 'authentication failed: invalid token',
            data: { reason: 'expired', expiredAt: 1779800000000 },
        },
    });
}
advance(1200);

// Error 3 — timeout on a long prompt.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'do something heavy' }] },
    }, 'session/prompt');
    // 30s of "trying"
    advance(28_000);
    // A few chunks before giving up.
    push('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hmm...' } } },
    }, 'session/update');
    advance(2_000);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: {
            code: -32000,
            message: 'upstream timeout after 30s',
            data: { upstream: 'anthropic.api', attempt: 1 },
        },
    });
}
advance(500);

// Error 4 — fs/write_text_file rejected by client (capability disabled).
{
    const id = ++rpcId;
    push('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'fs/write_text_file',
        params: { sessionId, path: '/etc/passwd', content: 'oops' },
    }, 'fs/write_text_file');
    advance(100);
    push('editor-to-agent', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'fs/write_text_file blocked by client policy' },
    });
}
advance(800);

// Error 5 — schema-rejection (agent rejects an unknown sessionUpdate the client sent).
// In real ACP the client doesn't send session/update, but the spec allows agent
// to error out on malformed extensions. Synthetic for coverage.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/cancel',
        params: { sessionId: 'nope-not-a-uuid' },
    }, 'session/cancel');
    advance(150);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'invalid params: sessionId must be a UUID', data: { path: 'params/sessionId' } },
    });
}
advance(900);

// A couple of successful frames in between for contrast (ERRORS insight
// fires only when there are some errors but the perf table also has clean
// data to compare against).
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'one that works' }] },
    }, 'session/prompt');
    advance(900);
    push('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Done.' } } },
    }, 'session/update');
    advance(200);
    push('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { stopReason: 'end_turn' },
    });
}
advance(700);

// Error 6 — rate limit (custom 429-style).
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'another one' }] },
    }, 'session/prompt');
    advance(200);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: {
            code: 429,
            message: 'rate limited — retry after 60s',
            data: { retryAfterMs: 60_000 },
        },
    });
}
advance(400);

// Error 7 — same prompt method, fails twice in a row.
for (let i = 0; i < 3; i++) {
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/load',
        params: { sessionId: 'no-such-session' },
    }, 'session/load');
    advance(80 + i * 30);
    push('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `attempt ${i + 1}: no such session 'no-such-session'` },
    });
    advance(200);
}

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-error-storm', version: '1.0.0' },
    session: {
        id: 0,
        name: 'error-storm-fixture',
        agentCommand: 'npx -y @agentclientprotocol/claude-agent-acp',
        clientName: 'WebStorm 2026.1.2',
        startedAt,
        endedAt,
    },
    messages,
};

const json = JSON.stringify(exportPayload, null, 2);
if (OUT_PATH) {
    writeFileSync(OUT_PATH, json);
    const errCount = messages.filter((m) => m.kind === 'error').length;
    process.stderr.write(
        `wrote ${messages.length} messages (${errCount} errors across ~6 methods) → ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
}

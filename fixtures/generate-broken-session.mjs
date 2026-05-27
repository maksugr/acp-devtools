#!/usr/bin/env node
// Synthesises an ACP session deliberately full of ACP-schema violations.
// Each frame parses as valid JSON-RPC (no parse-error), but the inner
// payload breaks the spec in a different way — useful for stress-testing
// `acp-devtools validate <id>`, the inspector's Spec tab, and the
// `find_spec_violations` MCP tool.
//
//   node fixtures/generate-broken-session.mjs --out /tmp/broken.json
//   acp-devtools import /tmp/broken.json
//
// Run `acp-devtools validate <new id>` on the imported session — you
// should see at least one violation per non-OK row below.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const OUT_PATH = flag('--out', null);
const SESSION_NAME = flag('--name', 'broken-spec-fixture');

const startedAt = Date.UTC(2026, 4, 27, 14, 0, 0, 0);
let ts = startedAt;
let seq = 0;
let rpcId = 0;
const messages = [];
const sessionId = '0eed7bdc-broken-fixture';

function pushFrame({ direction, kind, payload, method, parseError }) {
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
    if (parseError) frame.parseError = parseError;
    ts += 50 + Math.floor(Math.random() * 500);
}

function advance(ms) {
    ts += ms;
}

// Helper that ALSO returns the message so we can mutate before push.
function frame(direction, kind, payload, method) {
    seq += 1;
    const frameObj = {
        seq,
        timestamp: ts,
        direction,
        kind,
        raw: JSON.stringify(payload),
        payload,
    };
    if (method) frameObj.method = method;
    if (payload && payload.id !== undefined && payload.id !== null) {
        frameObj.rpcId = payload.id;
    }
    messages.push(frameObj);
    ts += 50 + Math.floor(Math.random() * 500);
    return frameObj;
}

// ── 1. A clean preamble so the session metadata extracts properly ──────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'JetBrains.WebStorm', title: 'WebStorm 2026.1.2', version: '2026.1.2' },
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        },
    }, 'initialize');
    frame('agent-to-editor', 'response', {
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

// ── 2. Violation: initialize REQUEST missing `protocolVersion` ─────────
// schema marks `protocolVersion` as required on InitializeRequest.
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            // protocolVersion intentionally missing
            clientInfo: { name: 'JetBrains.WebStorm', title: 'WebStorm 2026.1.2' },
        },
    }, 'initialize');
    frame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
    });
}
advance(800);

// ── 3. Violation: `session/prompt` missing `prompt` array ──────────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: {
            sessionId,
            // `prompt` missing — required by spec
        },
    }, 'session/prompt');
    frame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { stopReason: 'end_turn' },
    });
}
advance(700);

// ── 4. Violation: prompt block with wrong `type` (not in enum) ─────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: {
            sessionId,
            prompt: [{ type: 'video', src: 'rtmp://nope' }],
        },
    }, 'session/prompt');
    frame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { stopReason: 'end_turn' },
    });
}
advance(600);

// ── 5. Violation: notification carries an `id` field (forbidden) ───────
frame('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    id: 99, // notifications must NOT have an id per JSON-RPC 2.0
    method: 'session/update',
    params: {
        sessionId,
        update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'this notif has an id, which it should not' },
        },
    },
}, 'session/update');
advance(300);

// ── 6. Violation: `session/set_mode` missing `modeId` ──────────────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_mode',
        params: { sessionId },
        // modeId missing
    }, 'session/set_mode');
    frame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}
advance(400);

// ── 7. Violation: response missing both `result` and `error` ───────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_model',
        params: { sessionId, modelId: 'sonnet-4-5' },
    }, 'session/set_model');
    frame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        // result + error both absent
    });
}
advance(400);

// ── 8. Violation: error with `code` as string (must be number) ─────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'will fail' }] },
    }, 'session/prompt');
    frame('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: 'INTERNAL_ERROR', message: 'whoops' },
    });
}
advance(400);

// ── 9. Violation: session/update with unknown sessionUpdate kind ───────
frame('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
        sessionId,
        update: { sessionUpdate: 'time_travel', when: 'next-tuesday' },
    },
}, 'session/update');
advance(300);

// ── 10. Violation: set_config_option with type+value mismatch ──────────
// type='boolean' should be paired with value: boolean.
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_config_option',
        params: { type: 'boolean', value: 'not actually a boolean' },
    }, 'session/set_config_option');
    frame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}
advance(400);

// ── 11. Violation: fs/read_text_file response missing `content` ────────
{
    const id = ++rpcId;
    frame('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'fs/read_text_file',
        params: { sessionId, path: 'src/main.ts' },
    }, 'fs/read_text_file');
    frame('editor-to-agent', 'response', {
        jsonrpc: '2.0',
        id,
        result: {}, // missing required `content`
    });
}
advance(400);

// ── 12. Violation: tool_call notification missing `name` ───────────────
frame('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
        sessionId,
        update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-no-name',
            // name missing
            params: { command: 'echo broken' },
        },
    },
}, 'session/update');
advance(300);

// ── 13. Violation: completely unknown method ───────────────────────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/teleport',
        params: { sessionId, destination: 'mars' },
    }, 'session/teleport');
    frame('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'method not found' },
    });
}
advance(400);

// ── 14. Violation: missing `jsonrpc` envelope field ────────────────────
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        // jsonrpc: '2.0' intentionally missing
        id,
        method: 'session/set_mode',
        params: { sessionId, modeId: 'coding' },
    }, 'session/set_mode');
    frame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}
advance(400);

// ── 15. A few CLEAN frames at the end so partial sessions still parse ──
{
    const id = ++rpcId;
    frame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'this one is fine' }] },
    }, 'session/prompt');
    frame('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: 'OK' },
            },
        },
    }, 'session/update');
    frame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
}

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-broken-session', version: '1.0.0' },
    session: {
        id: 0,
        name: SESSION_NAME,
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
    process.stderr.write(
        `wrote ${messages.length} messages — about 14 distinct spec violations — to ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
    process.stderr.write(`\n${messages.length} messages (use --out PATH to write to a file)\n`);
}

#!/usr/bin/env node
// Synthesises a session dominated by `session/update` chunk-stream
// notifications — handful of prompts, ~800 streaming chunks. Useful for
// stress-testing:
//
// - the `StreamCluster` collapse heuristic (consecutive `agent_message_chunk`
//   notifications fold into a single row in the main Timeline)
// - the notification lane in the TimelineCanvas waterfall (densest lane)
// - the BUSIEST insight when one method utterly dominates message count
// - virtuoso scrolling with mostly-similar rows
//
//   node fixtures/generate-streaming-heavy.mjs --out /tmp/streams.json
//   acp-devtools import /tmp/streams.json
import { writeFileSync } from 'node:fs';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;

const startedAt = Date.UTC(2026, 4, 27, 9, 0, 0, 0);
let ts = startedAt;
let seq = 0;
let rpcId = 0;
const messages = [];
const sessionId = '0eed7bdc-streamy';

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
}

function advance(min, max) {
    ts += min + Math.floor(Math.random() * (max - min));
}

function streamLongResponse(text, chunkSize) {
    for (let i = 0; i < text.length; i += chunkSize) {
        advance(12, 35);
        push('agent-to-editor', 'notification', {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
                sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { text: text.slice(i, i + chunkSize) },
                },
            },
        }, 'session/update');
    }
}

// Preamble.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        },
    }, 'initialize');
    advance(60, 120);
    push('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: {
            protocolVersion: 1,
            agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
            agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
            authMethods: [],
        },
    });
}
advance(400, 800);

// Three prompts, each followed by a giant streamed response.
const PROMPTS = [
    'Tell me a long story about a parser. Make it at least 500 words.',
    'Walk me through every part of the ACP protocol with examples.',
    'Generate a 30-line poem about request/response cycles.',
];
const RESPONSES = [
    // ~1800 chars — splits into ~225 chunks at chunkSize=8.
    Array.from({ length: 80 }, () =>
        'Once upon a time the parser found a buffer it could not understand. ',
    ).join(''),
    // ~2200 chars — ~275 chunks.
    Array.from({ length: 60 }, () =>
        'The Agent Client Protocol describes a JSON-RPC pipe over stdio. Both peers may send notifications. ',
    ).join(''),
    // ~1500 chars — ~190 chunks.
    Array.from({ length: 30 }, () =>
        'A request goes out, a response comes back, in perfect rhythm we attack. ',
    ).join(''),
];

for (let p = 0; p < PROMPTS.length; p++) {
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: PROMPTS[p] }] },
    }, 'session/prompt');
    advance(800, 1500);
    // Tiny chunkSize → many notifications per response.
    streamLongResponse(RESPONSES[p], 8);
    advance(150, 400);
    push('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    advance(1500, 3000);
}

// One last burst of chunks WITHOUT a paired request (simulates a tool's
// streaming side-channel) to test how unpaired notifications render.
for (let i = 0; i < 40; i++) {
    advance(20, 70);
    push('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: `progress ${i}/40` },
            },
        },
    }, 'session/update');
}

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-streaming-heavy', version: '1.0.0' },
    session: {
        id: 0,
        name: 'streaming-heavy-fixture',
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
    const ntfs = messages.filter((m) => m.kind === 'notification').length;
    process.stderr.write(
        `wrote ${messages.length} messages (${ntfs} streaming notifications) → ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
}

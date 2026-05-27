#!/usr/bin/env node
// Synthesises the smallest interesting session — `initialize` + one prompt
// + one response. Useful for exercising edge cases the bigger fixtures
// blow past:
//
// - percentile maths with a single latency sample (p50 == p99 == max)
// - perf insights skipped entirely (none of the thresholds met)
// - sparkline rendering with a single bar
// - layout when there is no idle gap to compress
// - JsonTree with a minimal payload
//
//   node fixtures/generate-tiny-session.mjs --out /tmp/tiny.json
//   acp-devtools import /tmp/tiny.json
import { writeFileSync } from 'node:fs';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;

const startedAt = Date.UTC(2026, 4, 27, 16, 0, 0, 0);
let ts = startedAt;
let seq = 0;
const messages = [];
const sessionId = '0eed7bdc-tiny';

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

// 1 — initialize
push('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: 1,
        clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    },
}, 'initialize');
ts += 120;
push('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: 1,
    result: {
        protocolVersion: 1,
        agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
        agentCapabilities: { loadSession: false },
        authMethods: [],
    },
});
ts += 800;

// 2 — single prompt
push('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: 2,
    method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text: 'hello' }] },
}, 'session/prompt');
ts += 1_400; // 1.4s — single latency sample
push('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi back' } } },
}, 'session/update');
ts += 30;
push('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: 2,
    result: { stopReason: 'end_turn' },
});

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-tiny-session', version: '1.0.0' },
    session: {
        id: 0,
        name: 'tiny-session-fixture',
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
    process.stderr.write(`wrote ${messages.length} messages (single prompt) → ${OUT_PATH}\n`);
} else {
    process.stdout.write(json);
}

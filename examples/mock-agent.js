#!/usr/bin/env node
// Minimal mock ACP agent used to exercise the acp-devtools proxy end-to-end.
//
// It speaks just enough of the protocol to make a `initialize` → `session/new`
// → `session/prompt` flow plausible: replies to client requests and emits one
// `session/update` notification per prompt. Frames are newline-delimited
// JSON-RPC 2.0, per the ACP wire format.
//
// Run directly (`node examples/mock-agent.js`) or through the proxy:
//   node packages/cli/dist/index.js proxy node examples/mock-agent.js
//
// Then paste JSON-RPC lines into stdin to observe the round trip.

import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = 1;
let nextNotificationId = 1;

function send(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
}

function log(message) {
    process.stderr.write(`[mock-agent] ${message}\n`);
}

function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
    send({ jsonrpc: '2.0', method, params });
}

function handle(message) {
    if (!message || message.jsonrpc !== '2.0') {
        log(`ignored non-JSON-RPC message: ${JSON.stringify(message)}`);
        return;
    }
    if (typeof message.method !== 'string') {
        log(`ignored response with no method: id=${message.id}`);
        return;
    }
    const { id, method, params } = message;
    log(`recv ${method}${id !== undefined ? ` (id=${id})` : ''}`);

    switch (method) {
        case 'initialize':
            reply(id, {
                protocolVersion: PROTOCOL_VERSION,
                agentCapabilities: { promptCapabilities: {} },
                authMethods: [],
            });
            return;

        case 'session/new':
            reply(id, { sessionId: `mock-session-${Date.now()}` });
            return;

        case 'session/prompt': {
            const sessionId = (params && params.sessionId) || 'unknown';
            reply(id, { stopReason: 'end_turn' });
            notify('session/update', {
                sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: 'pong from mock-agent' },
                },
            });
            log(`emitted session/update #${nextNotificationId++}`);
            return;
        }

        case 'session/cancel':
            log(`cancel for session ${params && params.sessionId}`);
            return;

        default:
            if (id !== undefined) replyError(id, -32601, `mock-agent does not implement ${method}`);
            else log(`dropped unknown notification ${method}`);
    }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (err) {
        log(`invalid JSON on stdin: ${err.message}`);
        return;
    }
    handle(parsed);
});
rl.on('close', () => {
    log('stdin closed, exiting');
    process.exit(0);
});

log('ready');

#!/usr/bin/env node
// Synthesises a session where the AGENT initiates requests against the
// EDITOR — `session/request_permission`, `fs/write_text_file`,
// `fs/read_text_file`, `terminal/create`. In all other fixtures editor→agent
// dominates; this one is the only thing that lights up the `agent → editor`
// lane in the TimelineCanvas waterfall, so it's useful for verifying the
// canvas correctly assigns those rects to lane index 1.
//
//   node fixtures/generate-permission-flow.mjs --out /tmp/perms.json
//   acp-devtools import /tmp/perms.json
import { writeFileSync } from 'node:fs';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;

const startedAt = Date.UTC(2026, 4, 27, 11, 15, 0, 0);
let ts = startedAt;
let seq = 0;
let rpcId = 0;
const messages = [];
const sessionId = '0eed7bdc-perms';

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

// Preamble — Claude Code style client with capabilities.
{
    const id = ++rpcId;
    push('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: true,
                auth: { terminal: true },
            },
        },
    }, 'initialize');
    advance(60, 140);
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
advance(300, 600);

// User asks to refactor a file.
const promptId = ++rpcId;
push('editor-to-agent', 'request', {
    jsonrpc: '2.0',
    id: promptId,
    method: 'session/prompt',
    params: {
        sessionId,
        prompt: [{ type: 'text', text: 'refactor src/main.ts and add error handling' }],
    },
}, 'session/prompt');
advance(800, 1400);

// Agent streams a thinking response.
push('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Reading the file first.' } } },
}, 'session/update');
advance(100, 250);

// Agent → editor: read the file (request from AGENT side — fills the agent-req lane).
function agentReads(path, content) {
    const id = ++rpcId;
    push('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'fs/read_text_file',
        params: { sessionId, path },
    }, 'fs/read_text_file');
    advance(8, 22);
    push('editor-to-agent', 'response', {
        jsonrpc: '2.0',
        id,
        result: { content },
    });
}

agentReads('src/main.ts', 'export function main(args) {\n    parse(args);\n}\n');
advance(180, 400);
agentReads('src/parser.ts', 'export function parse(args) {\n    return args.split(",");\n}\n');
advance(200, 500);

push('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: ' Now I need permission to write the new version.' } } },
}, 'session/update');
advance(100, 200);

// Agent → editor: request_permission (this is the canonical agent→editor case).
function permissionFlow(toolName, toolParams, approved) {
    const id = ++rpcId;
    push('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/request_permission',
        params: {
            sessionId,
            toolCall: {
                toolCallId: `tc-${id}`,
                name: toolName,
                params: toolParams,
            },
        },
    }, 'session/request_permission');
    advance(1_500, 4_500); // user thinking
    push('editor-to-agent', 'response', {
        jsonrpc: '2.0',
        id,
        result: { outcome: approved ? 'allowed' : 'denied' },
    });
}

// First permission — approved.
permissionFlow('Edit', {
    file_path: 'src/main.ts',
    old_string: 'parse(args);',
    new_string: 'try { parse(args); } catch (e) { console.error(e); }',
}, true);
advance(200, 500);

// Agent writes the file (agent-initiated write).
function agentWrites(path, content) {
    const id = ++rpcId;
    push('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'fs/write_text_file',
        params: { sessionId, path, content },
    }, 'fs/write_text_file');
    advance(20, 60);
    push('editor-to-agent', 'response', { jsonrpc: '2.0', id, result: null });
}

agentWrites('src/main.ts', 'export function main(args) {\n    try { parse(args); } catch (e) { console.error(e); }\n}\n');
advance(300, 700);

// Second permission — DENIED. Common when user is cautious.
permissionFlow('Bash', { command: 'rm -rf node_modules && npm install' }, false);
advance(400, 800);

push('agent-to-editor', 'notification', {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: ' OK, skipping that. Done.' } } },
}, 'session/update');
advance(200, 400);

// Agent → editor: terminal/create (another agent-initiated capability).
{
    const id = ++rpcId;
    push('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'terminal/create',
        params: { sessionId, command: 'echo hi', cwd: '/Users/dev/project' },
    }, 'terminal/create');
    advance(50, 120);
    push('editor-to-agent', 'response', {
        jsonrpc: '2.0',
        id,
        result: { terminalId: 'term-1', exitCode: 0, output: 'hi\n' },
    });
}
advance(200, 400);

// Close out the prompt.
push('agent-to-editor', 'response', {
    jsonrpc: '2.0',
    id: promptId,
    result: { stopReason: 'end_turn' },
});

const endedAt = ts;
const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-permission-flow', version: '1.0.0' },
    session: {
        id: 0,
        name: 'permission-flow-fixture',
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
    const agentReqs = messages.filter(
        (m) => m.kind === 'request' && m.direction === 'agent-to-editor',
    ).length;
    process.stderr.write(
        `wrote ${messages.length} messages (${agentReqs} agent→editor requests) → ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
}

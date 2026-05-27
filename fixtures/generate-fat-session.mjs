#!/usr/bin/env node
// Synthesises a chunky multi-day ACP session as a SessionExport JSON file
// suitable for `acp-devtools import`. Used to stress-test the inspector UI
// — variety of message kinds, methods, idle gaps from seconds to days,
// streaming chunk bursts, tool calls, errors.
//
//   node fixtures/generate-fat-session.mjs > /tmp/fat-session.json
//   acp-devtools import /tmp/fat-session.json
//
// Output is deterministic given the same `--seed` (default 42) so runs are
// reproducible.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const SEED = Number(flag('--seed', '42'));
const OUT_PATH = flag('--out', null);
const SESSION_NAME = flag('--name', 'fat-session');

// Deterministic PRNG (Mulberry32) so reruns give the same payload.
let rngState = SEED >>> 0;
function rand() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => Math.floor(lo + rand() * (hi - lo));

// Timeline anchor: start three days ago at 09:42 local, walk forward.
const startedAt = Date.UTC(2026, 4, 24, 9, 42, 17, 0);
let ts = startedAt;
let seq = 0;
let rpcId = 0;
const messages = [];

const sessionId = `0eed7bdc-fat-${SEED.toString(16)}`;

function pushFrame(direction, kind, payload, method) {
    seq += 1;
    const raw = JSON.stringify(payload);
    const frame = {
        seq,
        timestamp: ts,
        direction,
        kind,
        raw,
        payload,
    };
    if (method) frame.method = method;
    if (payload.id !== undefined) frame.rpcId = payload.id;
    messages.push(frame);
}

function advanceMs(min, max) {
    ts += between(min, max);
}
function advanceSec(min, max) {
    advanceMs(min * 1000, max * 1000);
}
function advanceMin(min, max) {
    advanceMs(min * 60_000, max * 60_000);
}
function advanceHr(min, max) {
    advanceMs(min * 3600_000, max * 3600_000);
}
function advanceDays(min, max) {
    advanceMs(min * 86_400_000, max * 86_400_000);
}

// ── ACP message builders ────────────────────────────────────────────────
function reqInitialize() {
    const id = ++rpcId;
    const payload = {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: {
                name: 'JetBrains.WebStorm',
                title: 'WebStorm 2026.1.2',
                version: '2026.1.2',
                _meta: { platform: 'intellij' },
            },
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
                auth: { _meta: { gateway: true } },
            },
            _meta: {
                proxyConfig: {
                    proxies: [
                        {
                            apiType: { provider: 'anthropic' },
                            proxy: { url: 'http://127.0.0.1:50001' },
                        },
                    ],
                },
            },
        },
    };
    pushFrame('editor-to-agent', 'request', payload, 'initialize');
    advanceMs(50, 200);
    pushFrame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: {
            protocolVersion: 1,
            agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
            agentCapabilities: {
                loadSession: true,
                promptCapabilities: { image: true, audio: false },
            },
            authMethods: [{ id: 'oauth' }, { id: 'apikey' }],
        },
    });
}

function reqSessionNew() {
    const id = ++rpcId;
    pushFrame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/new',
        params: { workspaceUri: 'file:///Users/dev/project' },
    }, 'session/new');
    advanceSec(0.5, 2.5);
    pushFrame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { sessionId, currentMode: 'coding' },
    });
}

function notifAvailableCommands() {
    pushFrame('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
            sessionId,
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: [
                    { name: 'debug', description: 'inspect state' },
                    { name: 'compact', description: 'compact history' },
                    { name: 'init', description: 'reinitialize project' },
                    { name: 'review', description: 'review changes' },
                ],
            },
        },
    }, 'session/update');
}

function reqSetMode(modeId) {
    const id = ++rpcId;
    pushFrame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_mode',
        params: { sessionId, modeId },
    }, 'session/set_mode');
    advanceMs(20, 80);
    pushFrame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}

function reqSetModel(modelId) {
    const id = ++rpcId;
    pushFrame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_model',
        params: { sessionId, modelId },
    }, 'session/set_model');
    advanceMs(20, 80);
    pushFrame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}

function reqSetConfigOption(type, value) {
    const id = ++rpcId;
    pushFrame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/set_config_option',
        params: { type, value },
    }, 'session/set_config_option');
    advanceMs(2, 6);
    pushFrame('agent-to-editor', 'response', { jsonrpc: '2.0', id, result: null });
}

function streamChunks(text, chunkSize = 24) {
    for (let i = 0; i < text.length; i += chunkSize) {
        advanceMs(15, 60);
        pushFrame('agent-to-editor', 'notification', {
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

function toolCallEdit(file, oldStr, newStr) {
    pushFrame('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
            sessionId,
            update: {
                sessionUpdate: 'tool_call',
                toolCallId: `tc-${++rpcId}`,
                name: 'Edit',
                params: { file_path: file, old_string: oldStr, new_string: newStr },
            },
        },
    }, 'session/update');
}

function toolCallBash(cmd) {
    pushFrame('agent-to-editor', 'notification', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
            sessionId,
            update: {
                sessionUpdate: 'tool_call',
                toolCallId: `tc-${++rpcId}`,
                name: 'Bash',
                params: { command: cmd },
            },
        },
    }, 'session/update');
}

function fsRead(file) {
    const id = ++rpcId;
    pushFrame('agent-to-editor', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'fs/read_text_file',
        params: { sessionId, path: file },
    }, 'fs/read_text_file');
    advanceMs(2, 28);
    pushFrame('editor-to-agent', 'response', {
        jsonrpc: '2.0',
        id,
        result: { content: `// contents of ${file}\nexport const x = 1;\n` },
    });
}

function reqSessionPrompt(text) {
    const id = ++rpcId;
    pushFrame('editor-to-agent', 'request', {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: {
            sessionId,
            prompt: [{ type: 'text', text }],
            _meta: { additionalRoots: ['file:///Users/dev/project'] },
        },
    }, 'session/prompt');
    return id;
}

function respPromptOk(id) {
    pushFrame('agent-to-editor', 'response', {
        jsonrpc: '2.0',
        id,
        result: { stopReason: 'end_turn' },
    });
}

function respPromptError(id, message) {
    pushFrame('agent-to-editor', 'error', {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message },
    });
}

const FILE_POOL = [
    'src/index.ts',
    'src/server/http.ts',
    'src/storage/session.ts',
    'src/acp/parser.ts',
    'packages/ui/src/App.tsx',
    'packages/ui/src/components/TimelineCanvas.tsx',
    'packages/cli/src/commands/stats.ts',
    'README.md',
    'plan.md',
];

const PROMPT_POOL = [
    'List files in src/',
    'Refactor the parser to be cleaner',
    'Why is the timeline appearing broken when there are big gaps?',
    'Add a test that verifies long-tail detection works for sub-second methods',
    'Inspect captures.db schema and propose a migration',
    'The perf panel header is misaligned — fix the indent on column headers',
    'Write a changelog summarising recent commits',
    'Find every place in the codebase that does `process.env`',
    'Convert this for-loop to a reduce',
    'My production build is 5KB larger — bisect and explain',
];

// Bigger reusable helpers — one prompt with a generous response + tool calls.
function bigBurst({ prompts = 3, chunkLen = 200, fsReads = 8, edits = 2, withError = false } = {}) {
    for (let p = 0; p < prompts; p++) {
        advanceSec(1, 6);
        const id = reqSessionPrompt(pick(PROMPT_POOL));
        advanceMs(600, 1400);
        // Generate a chunky stream of randomly-sized lines.
        const text = Array.from({ length: between(3, 9) }, () => {
            const line = Array.from({ length: between(8, 14) }, () =>
                pick(['the', 'parser', 'event', 'agent', 'request', 'value', 'method', 'session', 'state', 'callback']),
            ).join(' ');
            return line + '.';
        }).join('\n').slice(0, chunkLen);
        streamChunks(text, between(16, 40));
        for (let i = 0; i < fsReads; i++) fsRead(pick(FILE_POOL));
        for (let i = 0; i < edits; i++) {
            toolCallEdit(pick(FILE_POOL), `const v${i} = 'old'`, `const v${i} = 'new'`);
        }
        if (p % 3 === 1) toolCallBash(pick(['npm test', 'git status', 'ls -la src/', 'cat package.json']));
        advanceSec(0.3, 1.5);
        if (withError && p === Math.floor(prompts / 2)) {
            respPromptError(id, "tool 'Bash' is not available in this environment");
        } else {
            respPromptOk(id);
        }
    }
}

// ── Synthetic timeline ──────────────────────────────────────────────────
// Day 0 — onboarding
reqInitialize();
advanceSec(0.5, 1.5);
reqSessionNew();
advanceSec(0.2, 0.6);
notifAvailableCommands();
reqSetMode('coding');
reqSetModel('claude-opus-4-7');

// Burst A — opening session, lots of work
bigBurst({ prompts: 5, fsReads: 10, edits: 3 });

// Idle 30s — sub-threshold, NOT compressed (sanity-check the threshold edge)
advanceSec(28, 32);
bigBurst({ prompts: 1, fsReads: 3, edits: 1 });

// Idle 90s — JUST over threshold, marker appears as "90s idle"
advanceSec(85, 95);
bigBurst({ prompts: 2, fsReads: 5, edits: 1 });

// Idle 7 minutes — coffee break
advanceMin(6, 8);
bigBurst({ prompts: 4, fsReads: 12, edits: 4 });

// Idle 45 minutes — lunch
advanceMin(40, 50);
for (let i = 0; i < 5; i++) {
    reqSetConfigOption(pick(['boolean', 'string']), pick([true, false, 'default', 'verbose']));
}
bigBurst({ prompts: 6, fsReads: 18, edits: 5, withError: true });

// Idle 14 hours — overnight
advanceHr(13, 15);
notifAvailableCommands();
bigBurst({ prompts: 4, fsReads: 15, edits: 3 });

// Idle 2 hours — another break
advanceHr(1.5, 2.5);
bigBurst({ prompts: 3, fsReads: 8, edits: 2 });

// Idle 3 days — long weekend
advanceDays(2.8, 3.2);

// Monday return — big snapshot prompt + massive chunk stream
{
    reqSetMode('debug');
    advanceSec(0.5, 1.5);
    const id = reqSessionPrompt(
        'I am back. Summarise the project state, ten files I touched most, ' +
            'the open todo list, and the next three things to work on with rough estimates.',
    );
    advanceMs(1500, 2500);
    // Massive multi-paragraph stream to stress chunk grouping (~80 chunks)
    const longText = Array.from({ length: 30 }, (_, i) =>
        `Paragraph ${i + 1}. ` +
        Array.from({ length: 30 }, () =>
            pick(['the', 'parser', 'event', 'agent', 'request', 'value', 'method', 'session']),
        ).join(' ') + '.',
    ).join('\n\n');
    streamChunks(longText, 28);
    advanceMs(200, 600);
    respPromptOk(id);
}

// Idle 12 hours — Tuesday morning
advanceHr(11, 13);
bigBurst({ prompts: 3, fsReads: 6, edits: 2 });

// A few quick set_config_option toggles to populate the busiest insight
advanceMin(2, 5);
for (let i = 0; i < 60; i++) {
    reqSetConfigOption(pick(['boolean', 'string']), pick([true, false, 'default', 'verbose', 'quiet']));
    advanceMs(150, 600);
}

// One last burst with a deliberately slow prompt (creates a long-tail outlier)
advanceMin(1, 3);
{
    const id = reqSessionPrompt('This one will be slow on purpose.');
    advanceMs(15_000, 22_000); // p99-outlier prompt
    streamChunks('Took a while but here is the answer. Done.');
    respPromptOk(id);
}

// Idle 90 seconds — short final break
advanceSec(85, 95);
{
    const id = reqSessionPrompt('Run the test suite once more before I push.');
    advanceMs(500, 900);
    toolCallBash('npm run precommit');
    streamChunks('Done. All tests green.');
    advanceSec(0.4, 0.9);
    respPromptOk(id);
}

const endedAt = ts;

const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    tool: { name: 'generate-fat-session', version: '1.0.0' },
    session: {
        id: 0, // ignored on import
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
        `wrote ${messages.length} messages spanning ${((endedAt - startedAt) / 86_400_000).toFixed(1)} days → ${OUT_PATH}\n`,
    );
} else {
    process.stdout.write(json);
    process.stderr.write(
        `\n${messages.length} messages spanning ${((endedAt - startedAt) / 86_400_000).toFixed(1)} days (use --out PATH to write to a file)\n`,
    );
}

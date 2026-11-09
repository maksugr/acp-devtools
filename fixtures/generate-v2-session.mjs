#!/usr/bin/env node
// Records an ACP v2 session between the reference client and agent from
// `@agentclientprotocol/sdk` (its experimental v2 API) and writes it as an
// acp-devtools export. Both sides parse every frame with the SDK's generated
// schemas, so the result is real v2 wire traffic, not a hand-written sample.
//
// One prompt turn: initialize → session/new → session/prompt, then the agent
// reports `running`, thinks, asks permission for an edit, streams its reply,
// reports usage and goes `idle` with a stop reason. In v2 the prompt response
// only acknowledges the user message; the turn ends with that idle state.
//
//   node fixtures/generate-v2-session.mjs --out fixtures/v2-session.json
//   acp-devtools import fixtures/v2-session.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { agent, client, ndJsonStream } from '@agentclientprotocol/sdk/experimental/v2';

const OUT_PATH = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : null;
// The SDK doesn't export its package.json; find it next to a schema it does export.
const sdkRoot = join(
    dirname(
        createRequire(import.meta.url).resolve('@agentclientprotocol/sdk/schema/v2/schema.json'),
    ),
    '..',
    '..',
);
const SDK_VERSION = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')).version;

const STARTED_AT = Date.UTC(2026, 10, 7, 10, 0, 0, 0);
// Frames are timestamped on a fixed step rather than by the wall clock: both
// sides run in this process, so real timings would only be scheduler noise, and
// a fixed step keeps the output identical between runs (golden tests rely on it).
const FRAME_STEP_MS = 20;
const messages = [];

function record(direction, line) {
    const payload = JSON.parse(line);
    const frame = {
        seq: messages.length + 1,
        timestamp: STARTED_AT + (messages.length + 1) * FRAME_STEP_MS,
        direction,
        raw: line,
        payload,
    };
    if ('method' in payload) {
        frame.kind = 'id' in payload ? 'request' : 'notification';
        frame.method = payload.method;
    } else {
        frame.kind = 'error' in payload ? 'error' : 'response';
    }
    if ('id' in payload) frame.rpcId = payload.id;
    messages.push(frame);
}

// A byte pipe that records every newline-delimited frame passing through it.
function tappedPipe(direction) {
    const decoder = new TextDecoder();
    let buffer = '';
    return new TransformStream({
        transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (line) record(direction, line);
            }
            controller.enqueue(chunk);
        },
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSION_ID = 'sess_6f1c2a';
const USER_MESSAGE_ID = 'msg_user_1';
const AGENT_MESSAGE_ID = 'msg_agent_1';
const THOUGHT_ID = 'msg_thought_1';
const TOOL_CALL_ID = 'call_edit_1';

let turnDone;
const turnFinished = new Promise((resolve) => (turnDone = resolve));

const agentApp = agent({ name: 'fixture-agent' })
    .onRequest('initialize', ({ params }) => ({
        protocolVersion: params.protocolVersion,
        info: { name: 'fixture-agent', title: 'Fixture Agent', version: '0.1.0' },
        capabilities: {},
        authMethods: [],
    }))
    .onRequest('session/new', () => ({ sessionId: SESSION_ID }))
    .onRequest('session/prompt', ({ params, client: toClient }) => {
        const update = (u) =>
            toClient.notify('session/update', { sessionId: params.sessionId, update: u });
        // The turn runs after the response: v2 acknowledges the prompt first.
        void (async () => {
            await update({ sessionUpdate: 'state_update', state: 'running' });
            await sleep(60);
            await update({
                sessionUpdate: 'agent_thought_chunk',
                messageId: THOUGHT_ID,
                content: { type: 'text', text: 'The greeting lives in src/hello.ts.' },
            });
            await sleep(40);
            await update({
                sessionUpdate: 'tool_call_update',
                toolCallId: TOOL_CALL_ID,
                title: 'Edit src/hello.ts',
                kind: 'edit',
                status: 'pending',
            });
            const permission = await toClient.request('session/request_permission', {
                sessionId: params.sessionId,
                title: 'Edit src/hello.ts?',
                options: [
                    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
                    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
                ],
            });
            const allowed =
                permission.outcome.outcome === 'selected' &&
                permission.outcome.optionId === 'allow';
            await update({
                sessionUpdate: 'tool_call_update',
                toolCallId: TOOL_CALL_ID,
                status: allowed ? 'completed' : 'failed',
            });
            for (const text of [
                'Updated the greeting ',
                'in `src/hello.ts` ',
                'to say hello, world.',
            ]) {
                await sleep(30);
                await update({
                    sessionUpdate: 'agent_message_chunk',
                    messageId: AGENT_MESSAGE_ID,
                    content: { type: 'text', text },
                });
            }
            await update({
                sessionUpdate: 'usage_update',
                used: 18_240,
                size: 200_000,
                cost: { amount: 0.031, currency: 'USD' },
            });
            await update({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
        })();
        return { messageId: USER_MESSAGE_ID };
    });

const clientApp = client({ name: 'fixture-client' })
    .onRequest('session/request_permission', async () => {
        await sleep(250);
        return { outcome: { outcome: 'selected', optionId: 'allow' } };
    })
    .onNotification('session/update', ({ params }) => {
        if (params.update.sessionUpdate === 'state_update' && params.update.state === 'idle') {
            turnDone();
        }
    });

const toAgent = tappedPipe('editor-to-agent');
const toClient = tappedPipe('agent-to-editor');
agentApp.connect(ndJsonStream(toClient.writable, toAgent.readable));

await clientApp.connectWith(ndJsonStream(toAgent.writable, toClient.readable), async (cx) => {
    await cx.request('initialize', {
        protocolVersion: 2,
        info: { name: 'fixture-client', title: 'Fixture Client', version: '0.1.0' },
        capabilities: {},
    });
    const { sessionId } = await cx.request('session/new', {
        cwd: '/home/dev/project',
        mcpServers: [],
    });
    await cx.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Make the greeting say "hello, world".' }],
    });
    await turnFinished;
});

const exportPayload = {
    version: 1,
    exportedAt: STARTED_AT,
    tool: { name: 'generate-v2-session', version: SDK_VERSION },
    session: {
        id: 0,
        name: `ACP v2 reference session (@agentclientprotocol/sdk ${SDK_VERSION})`,
        agentCommand: 'fixture-agent',
        clientName: 'Fixture Client',
        startedAt: STARTED_AT,
        endedAt: messages.at(-1)?.timestamp ?? STARTED_AT,
    },
    messages,
};

const json = JSON.stringify(exportPayload, null, 2) + '\n';
if (OUT_PATH) {
    writeFileSync(OUT_PATH, json);
    process.stderr.write(`wrote ${messages.length} ACP v2 frames → ${OUT_PATH}\n`);
} else {
    process.stdout.write(json);
}

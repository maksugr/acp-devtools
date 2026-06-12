#!/usr/bin/env node
// Drives one live prompt turn through the acp-devtools proxy against a real
// ACP agent: initialize → session/new → session/prompt ("reply with pong") →
// waits for the agent's prompt response. Unlike `mock-editor` (which replays
// recorded frames verbatim, including their recorded sessionId), this script
// adapts to the sessionId the agent actually returns, so it works against any
// agent — including ones never captured before. It produced the verified rows
// in the README's «Supported editors & agents» table.
//
// Usage (from the repo root):
//   node fixtures/drive-full-turn.mjs node fixtures/mock-agent.js
//   node fixtures/drive-full-turn.mjs npx -y @zed-industries/codex-acp
//   DRIVE_SAVE_TO=/tmp/smoke.db node fixtures/drive-full-turn.mjs goose acp
//
// The conversation is captured like any proxy run: shared captures database
// by default, or DRIVE_SAVE_TO=<file> to redirect. Uses the built CLI when
// `packages/cli/dist` exists, otherwise falls back to the TypeScript sources
// via tsx (works on a fresh clone before `npm run build`).
//
// Exit codes: 0 = full prompt turn completed · 3 = handshake OK but
// session/new refused (usually authentication required) · 1 = agent never
// answered · 2 = usage error.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const agentCommand = process.argv.slice(2);
if (agentCommand.length === 0) {
    process.stderr.write('usage: node fixtures/drive-full-turn.mjs <agent-command> [args…]\n');
    process.exit(2);
}

const distEntry = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));
const srcEntry = fileURLToPath(new URL('../packages/cli/src/index.ts', import.meta.url));
const cliArgs = existsSync(distEntry) ? [distEntry] : ['--import', 'tsx', srcEntry];
const saveTo = process.env.DRIVE_SAVE_TO ? ['--save-to', process.env.DRIVE_SAVE_TO] : [];

const child = spawn(
    process.execPath,
    [...cliArgs, 'proxy', '--no-ws', ...saveTo, ...agentCommand],
    {
        stdio: ['pipe', 'pipe', 'inherit'],
    },
);

const log = (message) => process.stderr.write(`[drive-full-turn] ${message}\n`);
const send = (object) => child.stdin.write(JSON.stringify(object) + '\n');
const finish = (code) => {
    clearTimeout(timer);
    child.stdin.end();
    setTimeout(() => {
        child.kill();
        process.exit(code);
    }, 2000);
};

let stage = 'initialize';
const timer = setTimeout(() => {
    log(`timed out waiting for ${stage} (120s) — no answer from the agent`);
    child.kill();
    process.exit(1);
}, 120_000);

child.on('exit', (code) => {
    if (stage !== 'done') {
        log(`agent/proxy exited (code ${code}) before answering ${stage}`);
        process.exit(1);
    }
});

send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: 1,
        clientInfo: { name: 'acp-devtools-drive-full-turn', version: '0.2.4' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    },
});

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        return;
    }
    if (message.id === 1) {
        if (message.error) {
            log(`initialize refused: ${JSON.stringify(message.error)}`);
            stage = 'done';
            finish(1);
            return;
        }
        const info = message.result.agentInfo;
        log(`initialize OK${info ? ` — ${info.name} ${info.version}` : ' (no agentInfo)'}`);
        stage = 'session/new';
        send({
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: { cwd: '/tmp', mcpServers: [] },
        });
    } else if (message.id === 2) {
        if (message.error) {
            log(`handshake OK, session/new refused: ${JSON.stringify(message.error)}`);
            stage = 'done';
            finish(3);
            return;
        }
        stage = 'session/prompt';
        send({
            jsonrpc: '2.0',
            id: 3,
            method: 'session/prompt',
            params: {
                sessionId: message.result.sessionId,
                prompt: [
                    {
                        type: 'text',
                        text: 'Reply with exactly the word: pong. Nothing else, no tools.',
                    },
                ],
            },
        });
    } else if (message.id === 3) {
        if (message.error) {
            log(`handshake OK, session/prompt refused: ${JSON.stringify(message.error)}`);
            stage = 'done';
            finish(3);
            return;
        }
        log(`full turn completed — stopReason: ${message.result.stopReason}`);
        stage = 'done';
        finish(0);
    } else if (message.method === 'session/request_permission' && message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } });
    }
});

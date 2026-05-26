#!/usr/bin/env node
// Tiny WebSocket subscriber that prints every acp-devtools event it receives.
//
// Usage:
//   node fixtures/ws-client.js                        # auto-discover the newest live capture
//   node fixtures/ws-client.js <url>                  # explicit url
//   node fixtures/ws-client.js <url> <timeout-ms>     # url + exit after N ms
//
// With no URL, the script reads ~/.acp-devtools/active/ (or whatever
// ACP_DEVTOOLS_HOME points at) and connects to the most recent live capture.
// Exits 0 once a `session.end` event arrives, on connection close, or when
// the optional timeout elapses.

import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

const RETRY_ATTEMPTS = 50;
const RETRY_DELAY_MS = 100;

function activeDir() {
    const base = process.env.ACP_DEVTOOLS_HOME ?? join(homedir(), '.acp-devtools');
    return join(base, 'active');
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

function listActiveCaptures() {
    let entries;
    try {
        entries = readdirSync(activeDir());
    } catch {
        return [];
    }
    const out = [];
    for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        try {
            const parsed = JSON.parse(readFileSync(join(activeDir(), name), 'utf8'));
            if (parsed && parsed.version === 1 && typeof parsed.pid === 'number' && isAlive(parsed.pid)) {
                out.push(parsed);
            }
        } catch {
            // skip malformed file
        }
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
}

function resolveTargetUrl() {
    const arg = process.argv[2];
    if (arg) return arg;
    const captures = listActiveCaptures();
    if (captures.length === 0) {
        process.stderr.write(
            `[ws-client] no URL given and no active captures found in ${activeDir()}\n` +
                '[ws-client] start a proxy first (acp-devtools proxy …) or pass a ws:// URL.\n',
        );
        process.exit(1);
    }
    if (captures.length > 1) {
        process.stderr.write('[ws-client] multiple captures detected, picking newest:\n');
        for (const c of captures) {
            const marker = c === captures[0] ? '*' : ' ';
            process.stderr.write(
                `  ${marker} ${c.url}  ${c.agentCommand}  (pid ${c.pid}, ${c.sessionName ?? 'unnamed'})\n`,
            );
        }
    }
    return captures[0].url;
}

const url = resolveTargetUrl();
const timeoutMs = process.argv[3] ? Number(process.argv[3]) : 0;

function probePort(host, port) {
    return new Promise((resolve) => {
        const sock = net.createConnection({ host, port });
        sock.once('connect', () => {
            sock.end();
            resolve(true);
        });
        sock.once('error', () => resolve(false));
    });
}

async function waitForPort(target) {
    const parsed = new URL(target);
    const host = parsed.hostname;
    const port = Number(parsed.port);
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        if (await probePort(host, port)) return;
        if (attempt === 0) process.stderr.write(`[ws-client] waiting for ${target}…\n`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    throw new Error(`port not open after ${RETRY_ATTEMPTS} attempts: ${target}`);
}

await waitForPort(url);

const ws = await new Promise((resolve, reject) => {
    const candidate = new WebSocket(url);
    candidate.once('open', () => resolve(candidate));
    candidate.once('error', reject);
});
process.stderr.write(`[ws-client] connected to ${url}\n`);

let timer = null;
if (timeoutMs > 0) {
    timer = setTimeout(() => {
        process.stderr.write(`[ws-client] timeout ${timeoutMs}ms\n`);
        ws.close();
        process.exit(0);
    }, timeoutMs);
}

ws.on('message', (data) => {
    const event = JSON.parse(data.toString());
    process.stdout.write(JSON.stringify(event) + '\n');
    if (event.type === 'session.end') {
        if (timer) clearTimeout(timer);
        ws.close();
        setTimeout(() => process.exit(0), 50);
    }
});

ws.on('close', () => {
    process.stderr.write('[ws-client] connection closed\n');
});

ws.on('error', (err) => {
    process.stderr.write(`[ws-client] error: ${err.message}\n`);
    process.exit(1);
});

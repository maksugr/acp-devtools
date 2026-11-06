// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnAgent } from './subprocess.js';

// An "agent" that exits immediately while a child it spawned keeps the
// inherited stdout open and writes to it later. This reproduces, on every
// OS, what Windows pipes do on their own: the agent's `exit` event arrives
// before its last stdout bytes have been read.
const AGENT = `
const { spawn } = require('node:child_process');
const [holdMs, exitCode] = process.argv.slice(2).map(Number);
const child = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => process.stdout.write("late frame\\\\n"), ' + holdMs + ')'],
    { stdio: ['ignore', 'inherit', 'ignore'] },
);
process.stdout.write('pid:' + child.pid + '\\n');
child.unref();
process.exit(exitCode);
`;

let dir: string;
let agentPath: string;
const strays: number[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-subprocess-'));
    agentPath = join(dir, 'agent.cjs');
    writeFileSync(agentPath, AGENT);
});

afterEach(() => {
    for (const pid of strays.splice(0)) {
        try {
            process.kill(pid);
        } catch {
            // already gone
        }
    }
    rmSync(dir, { recursive: true, force: true });
});

function run(holdMs: number, exitCode: number, stdioGraceMs?: number) {
    const agent = spawnAgent({
        command: process.execPath,
        args: [agentPath, String(holdMs), String(exitCode)],
        ...(stdioGraceMs !== undefined ? { stdioGraceMs } : {}),
    });
    let out = '';
    agent.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        const pid = /pid:(\d+)/.exec(out)?.[1];
        if (pid && !strays.includes(Number(pid))) strays.push(Number(pid));
    });
    return { agent, output: () => out };
}

describe('spawnAgent — exit handling', () => {
    it('resolves `exited` only after the agent stdout has been drained', async () => {
        const { agent, output } = run(300, 0);

        const info = await agent.exited;

        expect(output()).toContain('late frame');
        expect(info).toEqual({ code: 0, signal: null });
    });

    it('passes the exit code through', async () => {
        const { agent } = run(0, 3);
        expect(await agent.exited).toEqual({ code: 3, signal: null });
    });

    it('stops waiting for stdio after the grace period, so a stray child cannot hang it', async () => {
        const { agent, output } = run(60_000, 0, 200);
        const started = Date.now();

        const info = await agent.exited;

        expect(Date.now() - started).toBeLessThan(5_000);
        expect(info.code).toBe(0);
        expect(output()).not.toContain('late frame');
    });
});

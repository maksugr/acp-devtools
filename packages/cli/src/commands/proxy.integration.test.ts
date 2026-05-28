import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@acp-devtools/core';

// End-to-end smoke of the `proxy` command exercised as a real subprocess.
// Runs the CLI from source via tsx (a devDependency) so it works even before
// `build:full` — important because CI runs `test` before building the CLI
// bundle. The mock agent exits on stdin EOF, so the whole pipeline terminates
// on its own with no signals (keeps the test cross-platform).

// Vitest runs with the monorepo root as cwd.
const repoRoot = process.cwd();
const cliEntry = join(repoRoot, 'packages/cli/src/index.ts');
const mockAgent = join(repoRoot, 'fixtures/mock-agent.js');
const sampleInput = readFileSync(join(repoRoot, 'fixtures/sample-session.jsonl'), 'utf8');

interface ProxyRun {
    code: number | null;
    stderr: string;
}

function runProxy(args: string[], home: string): Promise<ProxyRun> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--import', 'tsx', cliEntry, 'proxy', ...args, process.execPath, mockAgent],
            {
                cwd: repoRoot,
                env: { ...process.env, ACP_DEVTOOLS_HOME: home },
                stdio: ['pipe', 'ignore', 'pipe'],
            },
        );
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => {
            stderr += d.toString();
        });
        const killer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`proxy did not exit within 15s. stderr:\n${stderr}`));
        }, 15_000);
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(killer);
            resolve({ code, stderr });
        });
        child.stdin.write(sampleInput);
        child.stdin.end();
    });
}

function dbCounts(dbPath: string): { sessions: number; messages: number; agentCommand: string | null; name: string | null } {
    const db = openDatabase(dbPath);
    try {
        const s = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
        const m = db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number };
        const row = db
            .prepare('SELECT agent_command, name FROM sessions LIMIT 1')
            .get() as { agent_command: string | null; name: string | null } | undefined;
        return {
            sessions: s.c,
            messages: m.c,
            agentCommand: row?.agent_command ?? null,
            name: row?.name ?? null,
        };
    } finally {
        db.close();
    }
}

let home: string;
let dbPath: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'acp-proxy-it-'));
    dbPath = join(home, 'captures.db');
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

describe('proxy command (integration)', () => {
    it(
        'captures a full session to SQLite and cleans up its discovery file on exit',
        async () => {
            const run = await runProxy(['--save-to', dbPath, '--ws-port', '0'], home);

            expect(run.code).toBe(0);

            // 3 editor requests + 3 agent responses + 1 notification = 7 frames.
            const counts = dbCounts(dbPath);
            expect(counts.sessions).toBe(1);
            expect(counts.messages).toBe(7);
            expect(counts.agentCommand).toContain('mock-agent.js');

            // The discovery descriptor written while live must be removed on exit.
            const activeDir = join(home, 'active');
            const leftover = existsSync(activeDir)
                ? readdirSync(activeDir).filter((f) => f.endsWith('.json'))
                : [];
            expect(leftover).toEqual([]);
        },
        20_000,
    );

    it(
        'records the session name and writes no discovery file with --no-ws',
        async () => {
            const run = await runProxy(
                ['--no-ws', '--save-to', dbPath, '--session-name', 'smoke'],
                home,
            );

            expect(run.code).toBe(0);
            const counts = dbCounts(dbPath);
            expect(counts.sessions).toBe(1);
            expect(counts.messages).toBe(7);
            expect(counts.name).toBe('smoke');

            // --no-ws means no broadcaster, so no discovery descriptor at all.
            const activeDir = join(home, 'active');
            const leftover = existsSync(activeDir)
                ? readdirSync(activeDir).filter((f) => f.endsWith('.json'))
                : [];
            expect(leftover).toEqual([]);
        },
        20_000,
    );
});

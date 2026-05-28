import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, Session, type CapturedMessage } from '@acp-devtools/core';

// End-to-end coverage of the read/manage CLI commands as real subprocesses.
// Runs the CLI from source via tsx (a devDependency) so it works before
// `build:full` — important because CI runs `test` before building the bundle.
// These tests exist because the command *actions* (which call process.exit)
// were previously untested: footgun stray-db creation, export/replay path-vs-id,
// search/inspect no-match exit codes, and the invalid/not-found/missing-db
// exit-code contract all escaped unit tests and were caught only by hand.
//
// proxy → packages/cli/src/commands/proxy.integration.test.ts (spawns an agent)
// mcp   → packages/cli/src/commands/mcp.test.ts (in-memory transport, 22 tests)
// ui    → needs the embedded UI bundle (build:full); core/server/http.test covers the API

const repoRoot = process.cwd();
const cliEntry = join(repoRoot, 'packages/cli/src/index.ts');
const TIMEOUT = 20_000;

interface Run {
    code: number | null;
    out: string;
    err: string;
}

function run(args: string[], opts: { cwd?: string; stdin?: string } = {}): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
            // Run from the repo root so `--import tsx` resolves; commands never
            // depend on cwd (paths are passed absolutely). A stray-file guard
            // below proves no command writes into cwd.
            cwd: opts.cwd ?? repoRoot,
            env: { ...process.env, ACP_DEVTOOLS_HOME: home },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        const killer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`timed out: ${args.join(' ')}\n${err}`));
        }, TIMEOUT - 2000);
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(killer);
            resolve({ code, out, err });
        });
        if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
        else child.stdin.end();
    });
}

let seq = 0;
function req(method: string, params: unknown): CapturedMessage {
    const id = ++seq;
    const payload = { jsonrpc: '2.0' as const, id, method, params };
    return {
        seq: id,
        timestamp: 1_700_000_000_000 + id * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method,
        rpcId: id,
        raw: JSON.stringify(payload),
        payload: payload as CapturedMessage['payload'],
    };
}
function resp(rpcId: number, result: unknown): CapturedMessage {
    const s = ++seq;
    const payload = { jsonrpc: '2.0' as const, id: rpcId, result };
    return {
        seq: s,
        timestamp: 1_700_000_000_000 + s * 1000,
        direction: 'agent-to-editor',
        kind: 'response',
        rpcId,
        raw: JSON.stringify(payload),
        payload: payload as CapturedMessage['payload'],
    };
}

const validInitParams = {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    clientInfo: { name: 'zed', title: 'Zed', version: '1.0' },
};
const validInitResult = {
    protocolVersion: 1,
    agentCapabilities: { promptCapabilities: {} },
    agentInfo: { name: 'mock-agent', title: 'Mock', version: '1.0' },
    authMethods: [],
};

let home: string;
let workDir: string;
let dbPath: string;
let missingDb: string;
let repoSnapshot: Set<string>;
let id1: number; // clean Zed session
let id2: number; // clean WebStorm session (differs from id1 in clientInfo)
let id3: number; // broken: invalid initialize (schema violation)

beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'acp-cli-it-home-'));
    workDir = mkdtempSync(join(tmpdir(), 'acp-cli-it-cwd-'));
    dbPath = join(home, 'captures.db');
    missingDb = join(home, 'does-not-exist.db');
    repoSnapshot = new Set(readdirSync(repoRoot));

    const db = openDatabase(dbPath);

    seq = 0;
    const s1 = Session.start(db, { name: 'alpha', agentCommand: 'mock' });
    s1.setClientName('Zed');
    s1.record(req('initialize', validInitParams));
    s1.record(resp(1, validInitResult));
    s1.close();
    id1 = s1.info.id;

    seq = 0;
    const s2 = Session.start(db, { name: 'beta', agentCommand: 'mock' });
    s2.setClientName('WebStorm');
    s2.record(
        req('initialize', {
            ...validInitParams,
            clientInfo: { name: 'webstorm', title: 'WebStorm', version: '2.0' },
        }),
    );
    s2.record(resp(1, validInitResult));
    s2.close();
    id2 = s2.info.id;

    seq = 0;
    const s3 = Session.start(db, { name: 'broken', agentCommand: 'mock' });
    s3.record(req('initialize', {})); // missing required protocolVersion → schema violation
    s3.close();
    id3 = s3.info.id;

    db.close();
});

afterAll(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
});

describe('CLI integration — per-command behavior', () => {
    describe('diff', () => {
        it('aligns two sessions with set-membership labels', async () => {
            const r = await run(['diff', String(id1), String(id2), '--db', dbPath]);
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/same/);
            expect(r.out).toMatch(/differs/);
        }, TIMEOUT);

        it('--json keeps stable machine field names and consistent totals', async () => {
            const r = await run(['diff', String(id1), String(id2), '--db', dbPath, '--json']);
            expect(r.code).toBe(0);
            const j = JSON.parse(r.out) as {
                summary: { equal: number; changed: number; added: number; removed: number; total: number };
                rows: unknown[];
            };
            expect(Object.keys(j.summary).sort()).toEqual(
                ['added', 'changed', 'equal', 'removed', 'total'].sort(),
            );
            const { equal, changed, added, removed, total } = j.summary;
            expect(equal + changed + added + removed).toBe(total);
        }, TIMEOUT);

        it('reports identical sessions', async () => {
            const r = await run(['diff', String(id1), String(id1), '--db', dbPath]);
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/identical/i);
        }, TIMEOUT);
    });

    describe('export', () => {
        it('exports a session by id as valid JSON', async () => {
            const r = await run(['export', String(id1), '--db', dbPath]);
            expect(r.code).toBe(0);
            const j = JSON.parse(r.out) as { session: { id: number }; messages: unknown[] };
            expect(j.session.id).toBe(id1);
            expect(j.messages.length).toBe(2);
        }, TIMEOUT);

        it('with no id exports the latest', async () => {
            const r = await run(['export', '--db', dbPath]);
            expect(r.code).toBe(0);
            const j = JSON.parse(r.out) as { session: { id: number } };
            expect(j.session.id).toBe(id3); // newest
        }, TIMEOUT);
    });

    describe('replay', () => {
        it('binds a WebSocket and streams the recorded session', async () => {
            const { WebSocket } = await import('ws');
            const child = spawn(
                process.execPath,
                ['--import', 'tsx', cliEntry, 'replay', String(id1), '--db', dbPath, '--ws-port', '0'],
                {
                    cwd: repoRoot,
                    env: { ...process.env, ACP_DEVTOOLS_HOME: home },
                    stdio: ['ignore', 'ignore', 'pipe'],
                },
            );
            try {
                const url = await new Promise<string>((resolve, reject) => {
                    let err = '';
                    const to = setTimeout(() => reject(new Error(`no ws url:\n${err}`)), 10_000);
                    child.stderr.on('data', (d: Buffer) => {
                        err += d.toString();
                        const m = err.match(/on (ws:\/\/\S+)/);
                        if (m) {
                            clearTimeout(to);
                            resolve(m[1]!);
                        }
                    });
                    child.on('error', reject);
                });
                const events = await new Promise<Array<{ type: string }>>((resolve, reject) => {
                    const ws = new WebSocket(url);
                    const got: Array<{ type: string }> = [];
                    const to = setTimeout(() => {
                        ws.close();
                        resolve(got);
                    }, 4000);
                    ws.on('message', (data: Buffer) => {
                        try {
                            const e = JSON.parse(data.toString()) as { type: string };
                            got.push(e);
                            if (e.type === 'replay.done' || e.type === 'session.end') {
                                clearTimeout(to);
                                ws.close();
                                resolve(got);
                            }
                        } catch {
                            // ignore non-JSON frames
                        }
                    });
                    ws.on('error', reject);
                });
                const types = events.map((e) => e.type);
                expect(types).toContain('session.start');
                expect(types).toContain('message');
            } finally {
                child.kill('SIGKILL');
            }
        }, TIMEOUT);

        it('errors on a missing --db without binding', async () => {
            const r = await run(['replay', String(id1), '--db', missingDb]);
            expect(r.code).toBe(1);
            expect(r.err).toMatch(/no such database/);
        }, TIMEOUT);

        it('rejects a session id together with --file', async () => {
            const r = await run(['replay', String(id1), '--file', 'whatever.json', '--db', dbPath]);
            expect(r.code).toBe(2);
        }, TIMEOUT);
    });

    describe('import', () => {
        it('imports a JSON export into a fresh database', async () => {
            const expFile = join(workDir, 'exp.json');
            const exp = await run(['export', String(id1), '--db', dbPath]);
            writeFileSync(expFile, exp.out);
            const freshDb = join(home, 'imported.db');
            const r = await run(['import', expFile, '--db', freshDb]);
            expect(r.code).toBe(0);
            expect(existsSync(freshDb)).toBe(true);
            const list = await run(['list', '--db', freshDb, '--json']);
            expect((JSON.parse(list.out) as unknown[]).length).toBe(1);
        }, TIMEOUT);

        it('rejects malformed JSON with exit 1', async () => {
            const badFile = join(workDir, 'bad.json');
            writeFileSync(badFile, '{garbage');
            const r = await run(['import', badFile, '--db', join(home, 'i2.db')]);
            expect(r.code).toBe(1);
            expect(r.err).toMatch(/invalid JSON|import failed/i);
        }, TIMEOUT);
    });

    describe('delete', () => {
        it('deletes a session and reports a missing --db distinctly', async () => {
            // Work on a throwaway copy so we don't disturb the shared db.
            const delDb = join(home, 'del.db');
            const exp = await run(['export', String(id1), '--db', dbPath]);
            const f = join(workDir, 'for-del.json');
            writeFileSync(f, exp.out);
            await run(['import', f, '--db', delDb]);
            const del = await run(['delete', '1', '--db', delDb]);
            expect(del.code).toBe(0);
            expect(del.out + del.err).toMatch(/deleted/i);
            const after = await run(['list', '--db', delDb, '--json']);
            expect((JSON.parse(after.out) as unknown[]).length).toBe(0);

            const missing = await run(['delete', '1', '--db', missingDb]);
            expect(missing.code).toBe(1);
            expect(missing.err).toMatch(/no such database/);
        }, TIMEOUT);
    });

    describe('list', () => {
        it('--json returns the seeded sessions', async () => {
            const r = await run(['list', '--db', dbPath, '--json']);
            expect(r.code).toBe(0);
            const rows = JSON.parse(r.out) as Array<{ id: number }>;
            expect(rows.map((s) => s.id)).toEqual(expect.arrayContaining([id1, id2, id3]));
        }, TIMEOUT);

        it('a missing --db lists nothing (exit 0, no stray file)', async () => {
            const r = await run(['list', '--db', missingDb]);
            expect(r.code).toBe(0);
            expect(existsSync(missingDb)).toBe(false);
        }, TIMEOUT);
    });

    describe('inspect', () => {
        it('prints rows for a session', async () => {
            const r = await run(['inspect', String(id1), '--db', dbPath]);
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/initialize/);
        }, TIMEOUT);

        it('exits 1 when a filter matches nothing (grep-style)', async () => {
            const r = await run(['inspect', String(id1), '--db', dbPath, '--method', 'zzznope']);
            expect(r.code).toBe(1);
        }, TIMEOUT);

        it('--format jsonl emits one JSON object per line', async () => {
            const r = await run(['inspect', String(id1), '--db', dbPath, '--format', 'jsonl']);
            expect(r.code).toBe(0);
            const lines = r.out.trim().split('\n');
            expect(() => lines.map((l) => JSON.parse(l))).not.toThrow();
        }, TIMEOUT);
    });

    describe('search', () => {
        it('exits 0 on a hit', async () => {
            const r = await run(['search', 'initialize', '--db', dbPath]);
            expect(r.code).toBe(0);
        }, TIMEOUT);

        it('exits 1 on no match (grep-style)', async () => {
            const r = await run(['search', 'zzznopezzz', '--db', dbPath]);
            expect(r.code).toBe(1);
        }, TIMEOUT);
    });

    describe('session-info', () => {
        it('prints derived metadata; --json is valid', async () => {
            const text = await run(['session-info', String(id1), '--db', dbPath]);
            expect(text.code).toBe(0);
            expect(text.out).toMatch(/Zed/);
            const json = await run(['session-info', String(id1), '--db', dbPath, '--json']);
            expect(() => JSON.parse(json.out)).not.toThrow();
        }, TIMEOUT);
    });

    describe('stats', () => {
        it('aggregates a session; --json is valid', async () => {
            const r = await run(['stats', String(id1), '--db', dbPath, '--json']);
            expect(r.code).toBe(0);
            const j = JSON.parse(r.out) as { total: number };
            expect(j.total).toBe(2);
        }, TIMEOUT);
    });

    describe('validate', () => {
        it('exits 0 for a conformant session', async () => {
            const r = await run(['validate', String(id1), '--db', dbPath]);
            expect(r.code).toBe(0);
        }, TIMEOUT);

        it('exits 1 and reports violations for a broken session', async () => {
            const r = await run(['validate', String(id3), '--db', dbPath]);
            expect(r.code).toBe(1);
            expect(r.out + r.err).toMatch(/violation|must have required/i);
        }, TIMEOUT);
    });

    describe('backfill-metadata', () => {
        it('runs over all sessions', async () => {
            const r = await run(['backfill-metadata', '--db', dbPath]);
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/OK/);
        }, TIMEOUT);

        it('accepts a single id positionally', async () => {
            const r = await run(['backfill-metadata', String(id1), '--db', dbPath]);
            expect(r.code).toBe(0);
        }, TIMEOUT);
    });

    describe('doctor', () => {
        it('reports environment and state', async () => {
            const r = await run(['doctor']);
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/Environment/);
            expect(r.out).toMatch(/captures\.db/);
        }, TIMEOUT);
    });

    describe('mock-agent / mock-editor', () => {
        it('mock-agent replays the recorded agent side from stdin', async () => {
            const reqLine = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: validInitParams,
            });
            const r = await run(['mock-agent', '--session', String(id1), '--db', dbPath], {
                stdin: reqLine + '\n',
            });
            expect(r.code).toBe(0);
            expect(r.out).toMatch(/protocolVersion|agentInfo/);
        }, TIMEOUT);

        it('mock-editor drives an agent through the recorded editor side', async () => {
            const r = await run([
                'mock-editor',
                '--session',
                String(id1),
                '--db',
                dbPath,
                process.execPath,
                join(repoRoot, 'fixtures/mock-agent.js'),
            ]);
            expect(r.code).toBe(0);
        }, TIMEOUT);

        it('mock-agent fails on a missing database', async () => {
            const r = await run(['mock-agent', '--session', '1', '--db', missingDb]);
            expect(r.code).not.toBe(0);
            expect(r.err).toMatch(/no such database/);
        }, TIMEOUT);

        it('mock-editor fails on a missing database', async () => {
            const r = await run([
                'mock-editor',
                '--session',
                '1',
                '--db',
                missingDb,
                process.execPath,
                join(repoRoot, 'fixtures/mock-agent.js'),
            ]);
            expect(r.code).not.toBe(0);
            expect(r.err).toMatch(/no such database/);
        }, TIMEOUT);
    });

    describe('mcp (spawned stdio server)', () => {
        it('serves the read-only tools over a real process', async () => {
            const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
            const { StdioClientTransport } = await import(
                '@modelcontextprotocol/sdk/client/stdio.js'
            );
            const transport = new StdioClientTransport({
                command: process.execPath,
                args: ['--import', 'tsx', cliEntry, 'mcp', '--db', dbPath],
                cwd: repoRoot,
                env: { ...process.env, ACP_DEVTOOLS_HOME: home } as Record<string, string>,
            });
            const client = new Client({ name: 'cli-it', version: '1.0.0' });
            try {
                await client.connect(transport);
                const names = (await client.listTools()).tools.map((t) => t.name);
                expect(names).toContain('list_sessions');
                expect(names).toContain('diff_sessions');
            } finally {
                await client.close();
            }
        }, TIMEOUT);
    });
});

// The exit-code contract, asserted across EVERY id-taking command — so a
// regression in any one of them is caught, not just the command where a bug
// was first found.
describe('CLI integration — exit-code contract (all commands)', () => {
    const invalidCases: Array<[string, string[]]> = [
        ['stats', ['stats', 'abc']],
        ['inspect', ['inspect', 'abc']],
        ['validate', ['validate', 'abc']],
        ['session-info', ['session-info', 'abc']],
        ['export', ['export', 'abc']],
        ['replay', ['replay', 'abc']],
        ['delete', ['delete', 'abc']],
        ['diff (a)', ['diff', 'abc', '1']],
        ['diff (b)', ['diff', '1', 'abc']],
        ['backfill-metadata', ['backfill-metadata', 'abc']],
    ];
    it.each(invalidCases)('%s rejects a non-numeric id with exit 2', async (_name, args) => {
        const r = await run([...args, '--db', dbPath]);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(/invalid id/);
    }, TIMEOUT);

    const notFoundCases: Array<[string, string[]]> = [
        ['stats', ['stats', '999999']],
        ['inspect', ['inspect', '999999']],
        ['validate', ['validate', '999999']],
        ['session-info', ['session-info', '999999']],
        ['export', ['export', '999999']],
        ['replay', ['replay', '999999']],
        ['delete', ['delete', '999999']],
    ];
    it.each(notFoundCases)('%s exits 1 for a non-existent session', async (_name, args) => {
        const r = await run([...args, '--db', dbPath]);
        expect(r.code).toBe(1);
    }, TIMEOUT);

    const missingDbCases: Array<[string, string[]]> = [
        ['stats', ['stats', '1']],
        ['inspect', ['inspect', '1']],
        ['validate', ['validate', '1']],
        ['session-info', ['session-info', '1']],
        ['export', ['export', '1']],
        ['replay', ['replay', '1']],
        ['diff', ['diff', '1', '2']],
        ['search', ['search', 'x']],
        ['backfill-metadata', ['backfill-metadata']],
    ];
    it.each(missingDbCases)('%s errors on a missing --db (no stray file)', async (_name, args) => {
        const r = await run([...args, '--db', missingDb]);
        expect(r.code).toBe(1);
        expect(r.err).toMatch(/no such database/);
        expect(existsSync(missingDb)).toBe(false);
    }, TIMEOUT);

    it('no command created a stray database file in the repo root', () => {
        // The original footgun left `./24` behind. Nothing run above should
        // create a bare-numeric or *.db file in cwd.
        const strays = readdirSync(repoRoot).filter(
            (f) => !repoSnapshot.has(f) && (f.endsWith('.db') || /^\d+$/.test(f)),
        );
        expect(strays).toEqual([]);
    });
});

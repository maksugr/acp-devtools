// @vitest-environment node
//
// Golden tests for the user-facing surfaces: every fixture session is imported
// into a temporary database, then `validate --json` and `stats --json` run as
// real CLI subprocesses and the MCP analysis tools run in-process. Results are
// compared with committed snapshots in `__golden__/`, so a change in what the
// CLI or the MCP server reports for real traffic shows up as a diff in review.
// The analysis itself is covered per function in core's `acp/golden.test.ts`;
// this file catches wiring changes (pairing, filtering, output shape).
//
// After an intended change, regenerate with `npx vitest run -u` and review the
// diff in `__golden__/` before committing it.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { insertImportedSession, parseExport } from '@acp-devtools/core';
import { buildMcpServer } from './mcp.js';

const repoRoot = process.cwd();
const FIXTURES = join(repoRoot, 'fixtures');
const cliEntry = join(repoRoot, 'packages/cli/src/index.ts');
// Each subprocess pays tsx start-up; a few at a time keeps slow CI runners
// (Windows) well inside the timeout without serialising forty runs.
const CONCURRENCY = 4;
const MCP_TOOLS = [
    'find_spec_violations',
    'get_session_metadata',
    'get_latency_stats',
    'get_session_summary',
] as const;
// Fields that depend on when or in which order the fixture was imported, not
// on its content. `endedAt` is import time for captures that never closed.
const VOLATILE_KEYS = new Set([
    'sessionId',
    'session_id',
    'id',
    'importedAt',
    'imported_at',
    'endedAt',
    'ended_at',
]);

interface Fixture {
    name: string;
    json: string;
}

function loadFixtures(): Fixture[] {
    const out: Fixture[] = [];
    const handshakes = join(FIXTURES, 'handshakes');
    for (const file of readdirSync(handshakes)
        .filter((f) => f.endsWith('.json'))
        .sort()) {
        out.push({
            name: `handshakes/${file.replace(/\.json$/, '')}`,
            json: readFileSync(join(handshakes, file), 'utf8'),
        });
    }
    for (const file of readdirSync(FIXTURES)
        .filter((f) => /^generate-.*\.mjs$/.test(f))
        .sort()) {
        out.push({
            name: file.replace(/\.mjs$/, ''),
            json: execFileSync(process.execPath, [join(FIXTURES, file)], {
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore'],
            }),
        });
    }
    return out;
}

function runCli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
            cwd: repoRoot,
            env: { ...process.env, ACP_DEVTOOLS_HOME: tmp, NO_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, out, err }));
    });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
    const results: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++;
                results[i] = await fn(items[i]!);
            }
        }),
    );
    return results;
}

/**
 * Collapse entries that differ only in `seq` into one group with a frame count
 * and the first few seqs: synthetic fixtures repeat one broken shape hundreds
 * of times. A frame moving between groups, or a group's content changing, both
 * show up in the diff.
 */
function groupBySeq(entries: unknown): unknown {
    if (!Array.isArray(entries)) return entries;
    const groups = new Map<string, { entry: Record<string, unknown>; seqs: number[] }>();
    for (const e of entries as Array<Record<string, unknown>>) {
        const { seq, ...rest } = e;
        const key = JSON.stringify(rest);
        const group = groups.get(key) ?? { entry: rest, seqs: [] };
        group.seqs.push(seq as number);
        groups.set(key, group);
    }
    return [...groups.values()].map(({ entry, seqs }) => ({
        ...entry,
        frames: seqs.length,
        firstSeqs: seqs.slice(0, 5),
    }));
}

function groupFindings<T extends Record<string, unknown>>(report: T): T {
    return {
        ...report,
        ...('violations' in report ? { violations: groupBySeq(report.violations) } : {}),
        ...('advisories' in report ? { advisories: groupBySeq(report.advisories) } : {}),
    };
}

function stripVolatile(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripVolatile);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([k]) => !VOLATILE_KEYS.has(k))
                .map(([k, v]) => [k, stripVolatile(v)]),
        );
    }
    return value;
}

let tmp: string;
let dbPath: string;
const fixtures = loadFixtures();
const sessionIds = new Map<string, number>();
const cliResults = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-devtools-golden-'));
    dbPath = join(tmp, 'captures.db');
    for (const f of fixtures) {
        const { id } = insertImportedSession(dbPath, parseExport(f.json), {
            sourceFilename: `${f.name}.json`,
        });
        sessionIds.set(f.name, id);
    }
    const jobs = fixtures.flatMap((f) =>
        (['validate', 'stats'] as const).map((command) => ({ fixture: f.name, command })),
    );
    const runs = await mapLimit(jobs, CONCURRENCY, async ({ fixture, command }) => {
        const r = await runCli([
            command,
            String(sessionIds.get(fixture)),
            '--db',
            dbPath,
            '--json',
        ]);
        return { fixture, command, ...r };
    });
    for (const r of runs) {
        if (!r.out.trim()) throw new Error(`${r.command} ${r.fixture} printed nothing:\n${r.err}`);
        const entry = cliResults.get(r.fixture) ?? {};
        const output = stripVolatile(JSON.parse(r.out)) as Record<string, unknown>;
        entry[r.command] = { exitCode: r.code, output: groupFindings(output) };
        cliResults.set(r.fixture, entry);
    }
}, 240_000);

afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
});

async function mcpReport(sessionId: number): Promise<Record<string, unknown>> {
    const server = buildMcpServer({ db: dbPath, name: 'golden' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'golden', version: '1.0.0' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    try {
        const out: Record<string, unknown> = {};
        for (const tool of MCP_TOOLS) {
            const res = await client.callTool({ name: tool, arguments: { session_id: sessionId } });
            out[tool] = groupFindings(
                stripVolatile(res.structuredContent ?? res.content) as Record<string, unknown>,
            );
        }
        return out;
    } finally {
        await client.close();
        await server.close();
    }
}

describe('golden: CLI and MCP output for every fixture session', () => {
    for (const fixture of fixtures) {
        it(fixture.name, async () => {
            const golden = {
                cli: cliResults.get(fixture.name),
                mcp: await mcpReport(sessionIds.get(fixture.name)!),
            };
            await expect(JSON.stringify(golden, null, 2) + '\n').toMatchFileSnapshot(
                `./__golden__/${fixture.name.replace('/', '__')}.golden.json`,
            );
        });
    }
});

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportSessionFromParts, serializeExport } from '../storage/export.js';
import { openDatabase, type SqliteDatabase } from '../storage/sqlite.js';
import { Session } from '../storage/session.js';
import { createApiHandler } from './http.js';

interface MockReq {
    url: string;
    method: string;
}

interface MockRes {
    statusCode: number;
    headers: Record<string, string | number>;
    body: string;
    ended: boolean;
    setHeader(name: string, value: string | number): void;
    end(body?: string): void;
}

function makeReq(url: string, method = 'GET'): MockReq {
    return { url, method };
}

/**
 * A `Readable` stream tagged with HTTP req fields so handlers can treat it
 * as an `IncomingMessage`. Each call emits the given body in one chunk then
 * `end`, which is enough for our JSON POST handler.
 */
function makeStreamReq(
    url: string,
    method: string,
    body: string,
    headers: Record<string, string> = {},
): Readable & { url: string; method: string; headers: Record<string, string> } {
    const stream = Readable.from([Buffer.from(body, 'utf8')]) as Readable & {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
    };
    stream.url = url;
    stream.method = method;
    stream.headers = headers;
    return stream as Readable & { url: string; method: string; headers: Record<string, string> };
}

function waitForEnd(res: MockRes): Promise<void> {
    return new Promise((resolve) => {
        const check = () => {
            if (res.ended) resolve();
            else setTimeout(check, 5);
        };
        check();
    });
}

function makeRes(): MockRes {
    return {
        statusCode: 200,
        headers: {},
        body: '',
        ended: false,
        setHeader(name, value) {
            this.headers[name] = value;
        },
        end(body) {
            if (body !== undefined) this.body = body;
            this.ended = true;
        },
    };
}

let tmp: string;
let dbPath: string;
let db: SqliteDatabase;
let prevHome: string | undefined;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-devtools-http-'));
    // Isolate listActive() from the host's ~/.acp-devtools/active/
    prevHome = process.env.ACP_DEVTOOLS_HOME;
    process.env.ACP_DEVTOOLS_HOME = tmp;
    dbPath = join(tmp, 'captures.db');
    db = openDatabase(dbPath);
});

afterEach(() => {
    db.close();
    if (prevHome === undefined) delete process.env.ACP_DEVTOOLS_HOME;
    else process.env.ACP_DEVTOOLS_HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
});

describe('createApiHandler', () => {
    it('returns false for unknown paths so the caller can keep routing', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(false);
        expect(res.ended).toBe(false);
    });

    it('returns false for /api/other (unknown api route)', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/unknown');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(false);
    });

    it('GET /api/active returns the discovery list', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/active');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        const body = JSON.parse(res.body) as { captures: unknown[] };
        expect(body.captures).toEqual([]); // empty discovery dir
    });

    it('GET /api/active surfaces live descriptors from the discovery dir', () => {
        mkdirSync(join(tmp, 'active'), { recursive: true });
        writeFileSync(
            join(tmp, 'active', `${process.pid}.json`),
            JSON.stringify({
                version: 1,
                pid: process.pid,
                host: '127.0.0.1',
                port: 12345,
                url: 'ws://127.0.0.1:12345',
                agentCommand: 'goose acp',
                sessionName: null,
                sessionDbId: null,
                saveTo: null,
                startedAt: Date.now(),
            }),
        );
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/active');
        const res = makeRes();
        handler(req as never, res as never);
        const body = JSON.parse(res.body) as { captures: Array<{ agentCommand: string }> };
        expect(body.captures).toHaveLength(1);
        expect(body.captures[0]?.agentCommand).toBe('goose acp');
    });

    it('GET /api/sessions returns persisted sessions', () => {
        const session = Session.start(db, { name: 'work', agentCommand: 'mock' });
        session.setClientName('Zed');
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/sessions');
        const res = makeRes();
        handler(req as never, res as never);
        const body = JSON.parse(res.body) as { sessions: Array<{ id: number; client_name: string }> };
        expect(body.sessions).toHaveLength(1);
        expect(body.sessions[0]?.id).toBe(session.info.id);
        expect(body.sessions[0]?.client_name).toBe('Zed');
    });

    it('GET /api/info returns the configured binary path', () => {
        const handler = createApiHandler({
            capturesDbPath: dbPath,
            binaryPath: '/abs/path/to/acp-devtools',
        });
        const req = makeReq('/api/info');
        const res = makeRes();
        handler(req as never, res as never);
        const body = JSON.parse(res.body) as { binaryPath: string | null; platform: string };
        expect(body.binaryPath).toBe('/abs/path/to/acp-devtools');
        expect(body.platform).toBe(process.platform);
    });

    it('GET /api/info returns null binaryPath when omitted', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/info');
        const res = makeRes();
        handler(req as never, res as never);
        const body = JSON.parse(res.body) as { binaryPath: string | null };
        expect(body.binaryPath).toBeNull();
    });

    it('strips query strings before routing', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/active?ts=1234567');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        const body = JSON.parse(res.body) as { captures: unknown[] };
        expect(body.captures).toEqual([]);
    });

    it('returns 405 for non-GET methods on api endpoints', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/active', 'POST');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        expect(res.statusCode).toBe(405);
    });
});

describe('POST /api/import', () => {
    function buildExportJson(): string {
        const exp = exportSessionFromParts(
            {
                id: 99,
                name: null,
                agentCommand: 'mock',
                clientName: 'Zed',
                startedAt: 1_700_000_000_000,
                endedAt: 1_700_000_001_000,
                importedAt: null,
            },
            [
                {
                    seq: 1,
                    timestamp: 1_700_000_000_001,
                    direction: 'editor-to-agent',
                    kind: 'request',
                    method: 'initialize',
                    rpcId: 1,
                    raw: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
                    payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
                },
            ],
            { tool: { name: 'acp-devtools', version: '0.1.0' } },
        );
        return serializeExport(exp);
    }

    it('inserts a new session and returns its id', async () => {
        db.close();
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeStreamReq('/api/import', 'POST', buildExportJson(), {
            'x-acp-source-filename': 'sample.json',
        });
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        await waitForEnd(res);
        db = openDatabase(dbPath);
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as { id: number; messageCount: number };
        expect(body.id).toBeGreaterThan(0);
        expect(body.messageCount).toBe(1);
        const rows = db.prepare(`SELECT name, client_name, imported_at FROM sessions`).all() as Array<{
            name: string | null;
            client_name: string | null;
            imported_at: number | null;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.name).toBe('sample.json');
        expect(rows[0]?.client_name).toBe('Zed');
        expect(rows[0]?.imported_at).toEqual(expect.any(Number));
    });

    it('returns 400 with the parser message for malformed JSON', async () => {
        db.close();
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeStreamReq('/api/import', 'POST', '{garbage');
        const res = makeRes();
        handler(req as never, res as never);
        await waitForEnd(res);
        db = openDatabase(dbPath);
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/invalid JSON/);
    });

    it('returns 405 for GET', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/import', 'GET');
        const res = makeRes();
        handler(req as never, res as never);
        expect(res.statusCode).toBe(405);
    });
});

describe('GET /api/sessions/:id/messages', () => {
    it('returns the session record and its ordered frames', () => {
        const s = Session.start(db, { name: 'work', agentCommand: 'mock' });
        s.setClientName('Zed');
        s.record({
            seq: 1,
            timestamp: 1_700_000_000_001,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'initialize',
            rpcId: 1,
            raw: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
            payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
        });
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq(`/api/sessions/${s.info.id}/messages`);
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            session: { id: number; clientName: string | null };
            messages: Array<{ seq: number; method?: string }>;
        };
        expect(body.session.id).toBe(s.info.id);
        expect(body.session.clientName).toBe('Zed');
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0]?.method).toBe('initialize');
    });

    it('returns 404 for a missing session id', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/sessions/9999/messages');
        const res = makeRes();
        handler(req as never, res as never);
        expect(res.statusCode).toBe(404);
    });

    it('returns 405 for non-GET on the messages endpoint', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/sessions/1/messages', 'POST');
        const res = makeRes();
        handler(req as never, res as never);
        expect(res.statusCode).toBe(405);
        expect(res.headers['allow']).toBe('GET');
    });
});

describe('DELETE /api/sessions/:id', () => {
    it('deletes an existing session and returns 200', () => {
        const s = Session.start(db, { agentCommand: 'doomed' });
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq(`/api/sessions/${s.info.id}`, 'DELETE');
        const res = makeRes();
        expect(handler(req as never, res as never)).toBe(true);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { deleted: boolean; id: number };
        expect(body.deleted).toBe(true);
        expect(body.id).toBe(s.info.id);
    });

    it('returns 404 for a missing id', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/sessions/9999', 'DELETE');
        const res = makeRes();
        handler(req as never, res as never);
        expect(res.statusCode).toBe(404);
    });

    it('returns 405 for non-DELETE on /api/sessions/:id', () => {
        const handler = createApiHandler({ capturesDbPath: dbPath });
        const req = makeReq('/api/sessions/1', 'POST');
        const res = makeRes();
        handler(req as never, res as never);
        expect(res.statusCode).toBe(405);
        expect(res.headers['allow']).toBe('DELETE');
    });
});

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

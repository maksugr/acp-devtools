import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../storage/sqlite.js';
import { Session } from '../storage/session.js';
import type { CapturedMessage } from '../acp/types.js';
import { streamReplay } from './replay.js';

interface MockWs {
    readyState: number;
    OPEN: number;
    sent: unknown[];
    closed: boolean;
    send(payload: string): void;
    close(): void;
}

function makeMockWs(): MockWs {
    return {
        readyState: 1, // OPEN
        OPEN: 1,
        sent: [],
        closed: false,
        send(payload: string) {
            this.sent.push(JSON.parse(payload));
        },
        close() {
            this.closed = true;
            this.readyState = 3; // CLOSED
        },
    };
}

const silentLogger = {
    log: () => {},
    warn: () => {},
};

let tmp: string;
let dbPath: string;
let db: SqliteDatabase;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-devtools-replay-'));
    dbPath = join(tmp, 'captures.db');
    db = openDatabase(dbPath);
});

afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
});

function record(session: Session, seq: number, overrides: Partial<CapturedMessage> = {}): void {
    session.record({
        seq,
        timestamp: 1_700_000_000_000 + seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: `{"jsonrpc":"2.0","id":${seq},"method":"initialize"}`,
        payload: { jsonrpc: '2.0', id: seq, method: 'initialize' },
        ...overrides,
    } as CapturedMessage);
}

describe('streamReplay', () => {
    it('sends an error frame and closes when the db is missing', () => {
        const ws = makeMockWs();
        streamReplay(ws as never, 1, join(tmp, 'missing.db'), silentLogger);
        expect(ws.sent).toHaveLength(1);
        expect((ws.sent[0] as { type: string }).type).toBe('error');
        expect(ws.closed).toBe(true);
    });

    it('sends an error frame and closes when the session does not exist', () => {
        const ws = makeMockWs();
        streamReplay(ws as never, 999, dbPath, silentLogger);
        expect(ws.sent.length).toBeGreaterThan(0);
        expect((ws.sent[0] as { type: string }).type).toBe('error');
        expect(ws.closed).toBe(true);
    });

    it('streams session.start → messages → replay.done for an open session', () => {
        const session = Session.start(db, { name: 'demo', agentCommand: 'mock' });
        record(session, 1);
        record(session, 2, { kind: 'response', method: undefined, rpcId: 1 });
        const ws = makeMockWs();
        streamReplay(ws as never, session.info.id, dbPath, silentLogger);
        const types = ws.sent.map((p) => (p as { type: string }).type);
        // session is still open (endedAt null) — no session.end frame
        expect(types).toEqual(['session.start', 'message', 'message', 'replay.done']);
        expect(ws.closed).toBe(false); // streamReplay only closes on error paths
    });

    it('appends session.end when the session has ended', () => {
        const session = Session.start(db, { agentCommand: 'mock' });
        record(session, 1);
        session.close();
        const ws = makeMockWs();
        streamReplay(ws as never, session.info.id, dbPath, silentLogger);
        const types = ws.sent.map((p) => (p as { type: string }).type);
        expect(types).toEqual(['session.start', 'message', 'replay.done', 'session.end']);
    });

    it('streams every recorded message in seq order', () => {
        const session = Session.start(db, { agentCommand: 'mock' });
        for (let i = 1; i <= 10; i++) record(session, i);
        const ws = makeMockWs();
        streamReplay(ws as never, session.info.id, dbPath, silentLogger);
        const messages = ws.sent.filter(
            (p): p is { type: string; message: CapturedMessage } =>
                (p as { type: string }).type === 'message',
        );
        expect(messages).toHaveLength(10);
        expect(messages.map((m) => m.message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('stops sending if the socket closes mid-stream', () => {
        const session = Session.start(db, { agentCommand: 'mock' });
        for (let i = 1; i <= 5; i++) record(session, i);
        const ws = makeMockWs();
        let messageCount = 0;
        // Override `send` to close the socket after the 2nd message
        const realSend = ws.send.bind(ws);
        ws.send = function (payload: string) {
            const parsed = JSON.parse(payload) as { type: string };
            if (parsed.type === 'message') {
                messageCount += 1;
                if (messageCount === 2) {
                    this.readyState = 3; // simulate the peer closing
                }
            }
            realSend(payload);
        };
        streamReplay(ws as never, session.info.id, dbPath, silentLogger);
        const types = ws.sent.map((p) => (p as { type: string }).type);
        // Got start + 2 messages then bail-out — no more `message` frames
        expect(types.filter((t) => t === 'message')).toHaveLength(2);
    });
});

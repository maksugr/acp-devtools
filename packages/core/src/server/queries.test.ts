import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../storage/sqlite.js';
import { Session } from '../storage/session.js';
import type { CapturedMessage } from '../acp/types.js';
import { listSessionsSummary } from './queries.js';

let tmp: string;
let dbPath: string;
let db: SqliteDatabase;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-devtools-queries-'));
    dbPath = join(tmp, 'captures.db');
    db = openDatabase(dbPath);
});

afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
});

function mockMessage(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
        payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
        ...overrides,
    } as CapturedMessage;
}

describe('listSessionsSummary', () => {
    it('returns empty list for missing db', () => {
        const out = listSessionsSummary(join(tmp, 'does-not-exist.db'));
        expect(out).toEqual([]);
    });

    it('returns empty list for an empty captures.db', () => {
        const out = listSessionsSummary(dbPath);
        expect(out).toEqual([]);
    });

    it('returns one row per session with correct message_count', () => {
        const session = Session.start(db, { name: 'work', agentCommand: 'mock' });
        session.record(mockMessage(1));
        session.record(mockMessage(2));
        session.record(mockMessage(3));
        session.close();
        const out = listSessionsSummary(dbPath);
        expect(out).toHaveLength(1);
        expect(out[0]?.id).toBe(session.info.id);
        expect(out[0]?.name).toBe('work');
        expect(out[0]?.agent_command).toBe('mock');
        expect(out[0]?.message_count).toBe(3);
        expect(out[0]?.ended_at).toBeGreaterThan(0);
    });

    it('orders sessions newest first', () => {
        const s1 = Session.start(db, { agentCommand: 'first', startedAt: 1000 });
        const s2 = Session.start(db, { agentCommand: 'second', startedAt: 2000 });
        const s3 = Session.start(db, { agentCommand: 'third', startedAt: 3000 });
        const out = listSessionsSummary(dbPath);
        expect(out.map((r) => r.id)).toEqual([s3.info.id, s2.info.id, s1.info.id]);
    });

    it('respects the limit argument', () => {
        for (let i = 0; i < 5; i++) {
            Session.start(db, { agentCommand: `s${i}`, startedAt: 1000 + i });
        }
        const out = listSessionsSummary(dbPath, 3);
        expect(out).toHaveLength(3);
    });

    it('includes client_name when set', () => {
        const session = Session.start(db, { agentCommand: 'mock' });
        session.setClientName('Zed');
        const out = listSessionsSummary(dbPath);
        expect(out[0]?.client_name).toBe('Zed');
    });

    it('returns null client_name for sessions without one', () => {
        Session.start(db, { agentCommand: 'mock' });
        const out = listSessionsSummary(dbPath);
        expect(out[0]?.client_name).toBeNull();
    });
});

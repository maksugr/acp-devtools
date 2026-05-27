import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../storage/sqlite.js';
import { Session } from '../storage/session.js';
import type { CapturedMessage } from '../acp/types.js';
import { exportSessionFromParts } from '../storage/export.js';
import { deleteSession, insertImportedSession, listSessionsSummary } from './queries.js';

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

    it('exposes imported_at — null for live captures, non-null for imports', () => {
        Session.start(db, { agentCommand: 'live', startedAt: 1000 });
        const exp = exportSessionFromParts(
            {
                id: 99,
                name: 'src',
                agentCommand: 'mock',
                clientName: null,
                startedAt: 500,
                endedAt: 700,
                importedAt: null,
            },
            [mockMessage(1)],
            { tool: { name: 't', version: '1' } },
        );
        // queries.insertImportedSession opens its own DB connection — close
        // ours first so SQLite doesn't trip on the WAL lock on the same path.
        db.close();
        insertImportedSession(dbPath, exp);
        db = openDatabase(dbPath);

        const out = listSessionsSummary(dbPath);
        // Sort key is COALESCE(imported_at, started_at) DESC — the imported
        // row's imported_at (~Date.now()) towers over the live session's
        // started_at=1000, so the import comes first.
        expect(out.map((r) => r.imported_at)).toEqual([
            expect.any(Number),
            null,
        ]);
    });

    it('sorts imports by imported_at, not by their original started_at', () => {
        // Live capture started 2 hours ago — bigger started_at than the
        // import's original timestamp.
        Session.start(db, { agentCommand: 'live', startedAt: Date.now() - 7_200_000 });
        const exp = exportSessionFromParts(
            {
                id: 99,
                name: 'src',
                agentCommand: 'mock',
                clientName: null,
                startedAt: 1, // long-ago capture
                endedAt: 2,
                importedAt: null,
            },
            [mockMessage(1)],
            { tool: { name: 't', version: '1' } },
        );
        db.close();
        insertImportedSession(dbPath, exp);
        db = openDatabase(dbPath);

        const out = listSessionsSummary(dbPath);
        // The import was added "just now", so even though its original
        // started_at is tiny it should appear FIRST in the picker.
        expect(out[0]?.imported_at).toEqual(expect.any(Number));
        expect(out[1]?.imported_at).toBeNull();
    });
});

describe('insertImportedSession', () => {
    it('creates a new session with fresh id, preserves metadata, sets imported_at', () => {
        const exp = exportSessionFromParts(
            {
                id: 7,
                name: null,
                agentCommand: 'npx -y @zed/claude-code-acp',
                clientName: 'Zed',
                startedAt: 1_700_000_000_000,
                endedAt: 1_700_000_005_000,
                importedAt: null,
            },
            [
                mockMessage(1),
                mockMessage(2, { direction: 'agent-to-editor', kind: 'response', method: undefined }),
            ],
            { tool: { name: 't', version: '1' } },
        );
        db.close();
        const result = insertImportedSession(dbPath, exp, { sourceFilename: 'capture.json' });
        db = openDatabase(dbPath);

        expect(result.messageCount).toBe(2);
        expect(result.id).toBeGreaterThan(0);
        const summary = listSessionsSummary(dbPath);
        expect(summary).toHaveLength(1);
        expect(summary[0]?.id).toBe(result.id);
        expect(summary[0]?.name).toBe('capture.json'); // sourceFilename fallback
        expect(summary[0]?.client_name).toBe('Zed');
        expect(summary[0]?.message_count).toBe(2);
        expect(summary[0]?.imported_at).toEqual(expect.any(Number));
        expect(summary[0]?.started_at).toBe(1_700_000_000_000);
        expect(summary[0]?.ended_at).toBe(1_700_000_005_000);
    });

    it('keeps the export session.name when present (does not fall back to filename)', () => {
        const exp = exportSessionFromParts(
            {
                id: 1,
                name: 'preserved label',
                agentCommand: null,
                clientName: null,
                startedAt: 1000,
                endedAt: null,
                importedAt: null,
            },
            [],
            { tool: { name: 't', version: '1' } },
        );
        db.close();
        const result = insertImportedSession(dbPath, exp, { sourceFilename: 'fallback.json' });
        db = openDatabase(dbPath);
        expect(listSessionsSummary(dbPath)[0]?.name).toBe('preserved label');
        expect(result.id).toBeGreaterThan(0);
    });
});

describe('deleteSession', () => {
    it('removes the session and cascades messages', () => {
        const s = Session.start(db, { agentCommand: 'doomed' });
        s.record(mockMessage(1));
        s.record(mockMessage(2));
        s.close();
        db.close();

        const removed = deleteSession(dbPath, s.info.id);
        expect(removed).toBe(true);

        db = openDatabase(dbPath);
        const out = listSessionsSummary(dbPath);
        expect(out).toHaveLength(0);
        const rows = db
            .prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ?`)
            .get(s.info.id) as { c: number };
        expect(rows.c).toBe(0);
    });

    it('returns false for a missing id', () => {
        db.close();
        const removed = deleteSession(dbPath, 9999);
        db = openDatabase(dbPath);
        expect(removed).toBe(false);
    });

    it('returns false when the db file does not exist', () => {
        expect(deleteSession(join(tmp, 'nope.db'), 1)).toBe(false);
    });
});

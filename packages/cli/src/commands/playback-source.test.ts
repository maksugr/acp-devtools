import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    type CapturedMessage,
    Session,
    exportSessionFromParts,
    openDatabase,
    serializeExport,
    type SqliteDatabase,
} from '@acp-devtools/core';
import { loadPlaybackScript } from './playback-source.js';

const mk = (seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage => ({
    seq,
    timestamp: 1_700_000_000_000 + seq,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: seq,
    raw: `{"jsonrpc":"2.0","id":${seq},"method":"initialize"}`,
    payload: { jsonrpc: '2.0', id: seq, method: 'initialize' },
    ...overrides,
});

let tmp: string;
let dbPath: string;
let db: SqliteDatabase;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acp-playback-source-'));
    dbPath = join(tmp, 'captures.db');
    db = openDatabase(dbPath);
});

afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
});

describe('loadPlaybackScript', () => {
    it('loads the latest session from the db when neither --session nor --script is set', () => {
        Session.start(db, { name: 'old' }).close();
        const newer = Session.start(db, { name: 'new' });
        newer.record(mk(1));
        newer.close();
        db.close();

        const loaded = loadPlaybackScript({ db: dbPath });
        expect(loaded.messages).toHaveLength(1);
        expect(loaded.source).toContain(`session #${newer.info.id}`);

        db = openDatabase(dbPath);
    });

    it('loads a specific session by id', () => {
        const a = Session.start(db, { name: 'a' });
        a.record(mk(1));
        a.close();
        const b = Session.start(db, { name: 'b' });
        b.record(mk(2));
        b.record(mk(3));
        b.close();
        db.close();

        const loaded = loadPlaybackScript({ db: dbPath, session: String(a.info.id) });
        expect(loaded.messages).toHaveLength(1);
        expect(loaded.source).toContain(`session #${a.info.id}`);

        db = openDatabase(dbPath);
    });

    it('loads from a JSON file when --script is set', () => {
        const exp = exportSessionFromParts(
            {
                id: 99,
                name: null,
                agentCommand: 'mock',
                clientName: null,
                startedAt: 1,
                endedAt: 2,
                importedAt: null,
            },
            [mk(1), mk(2)],
            { tool: { name: 't', version: '1' } },
        );
        const filePath = join(tmp, 'foo.json');
        writeFileSync(filePath, serializeExport(exp));

        const loaded = loadPlaybackScript({ db: dbPath, script: filePath });
        expect(loaded.messages).toHaveLength(2);
        expect(loaded.source).toBe('foo.json');
    });

    it('rejects --script + --session together', () => {
        expect(() => loadPlaybackScript({ db: dbPath, script: 'x.json', session: '1' })).toThrow(
            /mutually exclusive/,
        );
    });

    it('rejects an invalid --session value', () => {
        expect(() => loadPlaybackScript({ db: dbPath, session: 'abc' })).toThrow(
            /invalid --session/,
        );
        expect(() => loadPlaybackScript({ db: dbPath, session: '0' })).toThrow(/invalid --session/);
    });

    it('errors with a helpful message when the db is empty and no --script given', () => {
        db.close();
        expect(() => loadPlaybackScript({ db: dbPath })).toThrow(/no sessions yet/);
        db = openDatabase(dbPath);
    });
});

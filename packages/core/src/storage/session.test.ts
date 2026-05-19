import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './sqlite.js';
import { Session } from './session.js';
import type { CapturedMessage } from '../acp/types.js';

const sample = (seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage => ({
    seq,
    timestamp: 1_700_000_000_000 + seq,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: seq,
    raw: `{"jsonrpc":"2.0","id":${seq},"method":"initialize","params":{}}`,
    payload: { jsonrpc: '2.0', id: seq, method: 'initialize', params: {} },
    ...overrides,
});

describe('Session', () => {
    let db: SqliteDatabase;
    beforeEach(() => {
        db = openDatabase(':memory:');
    });
    afterEach(() => {
        db.close();
    });

    it('records and replays a session', () => {
        const session = Session.start(db, { name: 't1', agentCommand: 'mock' });
        expect(session.info.endedAt).toBeNull();

        session.record(sample(1));
        session.record(sample(2, { direction: 'agent-to-editor', kind: 'response' }));
        session.record(sample(3, { kind: 'notification', method: 'session/update', rpcId: undefined }));

        session.close(1_700_000_010_000);
        expect(session.info.endedAt).toBe(1_700_000_010_000);

        const replayed = [...session.messages()];
        expect(replayed).toHaveLength(3);
        expect(replayed[0]?.seq).toBe(1);
        expect(replayed[1]?.direction).toBe('agent-to-editor');
        expect(replayed[2]?.method).toBe('session/update');
        expect(replayed[2]?.rpcId).toBeUndefined();
    });

    it('persists payloads as JSON and rehydrates them', () => {
        const session = Session.start(db);
        session.record(sample(1));
        const [msg] = [...session.messages()];
        expect(msg?.payload).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    });

    it('preserves string rpc ids', () => {
        const session = Session.start(db);
        session.record(sample(1, { rpcId: 'req-abc' }));
        const [msg] = [...session.messages()];
        expect(msg?.rpcId).toBe('req-abc');
    });

    it('stores parse errors when payload is null', () => {
        const session = Session.start(db);
        session.record(
            sample(1, { payload: null, parseError: 'invalid JSON', kind: 'unknown', method: undefined, rpcId: undefined }),
        );
        const [msg] = [...session.messages()];
        expect(msg?.payload).toBeNull();
        expect(msg?.parseError).toBe('invalid JSON');
    });

    it('loads a previously closed session by id', () => {
        const first = Session.start(db, { name: 'first' });
        first.record(sample(1));
        first.close();

        const loaded = Session.load(db, first.info.id);
        expect(loaded.info.name).toBe('first');
        expect([...loaded.messages()]).toHaveLength(1);
    });

    it('returns the most recent session via latest()', () => {
        Session.start(db, { name: 'one' }).close();
        const two = Session.start(db, { name: 'two' });
        const latest = Session.latest(db);
        expect(latest.info.id).toBe(two.info.id);
        expect(latest.info.name).toBe('two');
    });
});

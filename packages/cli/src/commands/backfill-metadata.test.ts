import { describe, expect, it } from 'vitest';
import { openDatabase, Session, type CapturedMessage } from '@acp-devtools/core';
import { backfillSession, listSessionIds } from './backfill-metadata.js';

function seed(): {
    db: ReturnType<typeof openDatabase>;
    sessionId: number;
} {
    const db = openDatabase(':memory:');
    const session = Session.start(db, { name: 'backfill-test', agentCommand: 'mock' });
    const initReq: CapturedMessage = {
        seq: 1,
        timestamp: 1_700_000_000_000,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: '1',
        raw: '{}',
        payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: 1,
                clientInfo: {
                    name: 'JetBrains.WebStorm',
                    title: 'WebStorm 2026.1.2',
                    version: '2026.1.2',
                    _meta: { platform: 'intellij' },
                },
            },
        } as unknown as CapturedMessage['payload'],
    };
    const initRsp: CapturedMessage = {
        seq: 2,
        timestamp: 1_700_000_001_000,
        direction: 'agent-to-editor',
        kind: 'response',
        rpcId: '1',
        raw: '{}',
        payload: {
            jsonrpc: '2.0',
            id: 1,
            result: {
                protocolVersion: 1,
                agentInfo: { name: 'mock-agent', version: '0.2.0' },
                agentCapabilities: { loadSession: true },
            },
        } as unknown as CapturedMessage['payload'],
    };
    session.record(initReq);
    session.record(initRsp);
    session.close();
    return { db, sessionId: session.info.id };
}

describe('backfillSession', () => {
    it('writes structured columns derived from messages', () => {
        const { db, sessionId } = seed();
        const result = backfillSession(db, sessionId);
        expect(result.ok).toBe(true);
        expect(result.protocolVersion).toBe(1);
        expect(result.client).toBe('WebStorm 2026.1.2');
        expect(result.agent).toBe('mock-agent');

        const reloaded = Session.load(db, sessionId);
        expect(reloaded.info.clientName).toBe('WebStorm 2026.1.2');
        expect(reloaded.info.clientVersion).toBe('2026.1.2');
        expect(reloaded.info.clientPlatform).toBe('intellij');
        expect(reloaded.info.agentName).toBe('mock-agent');
        expect(reloaded.info.agentVersion).toBe('0.2.0');
        expect(reloaded.info.protocolVersion).toBe(1);
        db.close();
    });

    it('falls back to clientInfo.name when title is absent', () => {
        const db = openDatabase(':memory:');
        const session = Session.start(db, { agentCommand: 'mock' });
        session.record({
            seq: 1,
            timestamp: 0,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'initialize',
            rpcId: '1',
            raw: '{}',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: 1,
                    clientInfo: { name: 'cursor' },
                },
            } as unknown as CapturedMessage['payload'],
        });
        session.close();
        const result = backfillSession(db, session.info.id);
        expect(result.ok).toBe(true);
        expect(result.client).toBe('cursor');
        db.close();
    });

    it('preserves an already-set clientName instead of overwriting', () => {
        const { db, sessionId } = seed();
        const before = Session.load(db, sessionId);
        before.setClientName('Manual Override');
        const result = backfillSession(db, sessionId);
        expect(result.client).toBe('Manual Override');
        expect(Session.load(db, sessionId).info.clientName).toBe('Manual Override');
        db.close();
    });

    it('returns ok=false for a non-existent session id', () => {
        const db = openDatabase(':memory:');
        const result = backfillSession(db, 9999);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/not found/);
        db.close();
    });

    it('idempotent — second run produces identical state', () => {
        const { db, sessionId } = seed();
        const first = backfillSession(db, sessionId);
        const snapshot1 = Session.load(db, sessionId).info;
        const second = backfillSession(db, sessionId);
        const snapshot2 = Session.load(db, sessionId).info;
        expect(first).toEqual(second);
        expect(snapshot1).toEqual(snapshot2);
        db.close();
    });
});

describe('listSessionIds', () => {
    it('returns empty list for fresh db', () => {
        const db = openDatabase(':memory:');
        expect(listSessionIds(db)).toEqual([]);
        db.close();
    });

    it('returns every session id in ascending order', () => {
        const db = openDatabase(':memory:');
        const a = Session.start(db, { agentCommand: 'a' });
        const b = Session.start(db, { agentCommand: 'b' });
        const c = Session.start(db, { agentCommand: 'c' });
        expect(listSessionIds(db)).toEqual([a.info.id, b.info.id, c.info.id]);
        db.close();
    });
});

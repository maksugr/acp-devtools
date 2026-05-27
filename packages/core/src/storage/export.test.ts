import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './sqlite.js';
import { Session } from './session.js';
import {
    EXPORT_VERSION,
    ExportParseError,
    exportSession,
    parseExport,
    serializeExport,
} from './export.js';
import type { CapturedMessage } from '../acp/types.js';

const TOOL = { name: 'acp-devtools-test', version: '9.9.9' };

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

describe('SessionExport', () => {
    let db: SqliteDatabase;
    beforeEach(() => {
        db = openDatabase(':memory:');
    });
    afterEach(() => {
        db.close();
    });

    it('round-trips a session through serialize/parse', () => {
        const session = Session.start(db, { name: 't1', agentCommand: 'mock' });
        session.setClientName('Zed');
        session.record(sample(1));
        session.record(sample(2, { direction: 'agent-to-editor', kind: 'response' }));
        session.record(
            sample(3, { kind: 'notification', method: 'session/update', rpcId: undefined }),
        );
        session.close(1_700_000_010_000);

        const exp = exportSession(session, { tool: TOOL, exportedAt: 1_700_000_020_000 });
        const json = serializeExport(exp);
        const parsed = parseExport(json);

        expect(parsed.version).toBe(EXPORT_VERSION);
        expect(parsed.exportedAt).toBe(1_700_000_020_000);
        expect(parsed.tool).toEqual(TOOL);
        expect(parsed.session.id).toBe(session.info.id);
        expect(parsed.session.clientName).toBe('Zed');
        expect(parsed.session.endedAt).toBe(1_700_000_010_000);
        expect(parsed.messages).toHaveLength(3);
        expect(parsed.messages[0]).toEqual(exp.messages[0]);
        expect(parsed.messages[2]?.method).toBe('session/update');
        expect(parsed.messages[2]?.rpcId).toBeUndefined();
    });

    it('serializes with 4-space indent and trailing newline', () => {
        const session = Session.start(db);
        session.record(sample(1));
        const json = serializeExport(exportSession(session, { tool: TOOL }));
        expect(json.endsWith('\n')).toBe(true);
        expect(json).toContain('    "version": 1');
    });

    it('rejects unsupported version', () => {
        const json = JSON.stringify({ version: 999, exportedAt: 0, tool: TOOL, session: {}, messages: [] });
        expect(() => parseExport(json)).toThrow(ExportParseError);
        expect(() => parseExport(json)).toThrow(/version 999/);
    });

    it('rejects malformed JSON with a helpful error', () => {
        expect(() => parseExport('{not json')).toThrow(ExportParseError);
        expect(() => parseExport('{not json')).toThrow(/invalid JSON/);
    });

    it('rejects messages with bad direction', () => {
        const session = Session.start(db);
        session.record(sample(1));
        const exp = exportSession(session, { tool: TOOL });
        const json = serializeExport(exp).replace('"editor-to-agent"', '"sideways"');
        expect(() => parseExport(json)).toThrow(/direction/);
    });

    it('preserves parse errors and null payloads', () => {
        const session = Session.start(db);
        session.record(
            sample(1, {
                payload: null,
                parseError: 'invalid JSON',
                kind: 'unknown',
                method: undefined,
                rpcId: undefined,
                raw: '{garbage',
            }),
        );
        const parsed = parseExport(serializeExport(exportSession(session, { tool: TOOL })));
        expect(parsed.messages[0]?.payload).toBeNull();
        expect(parsed.messages[0]?.parseError).toBe('invalid JSON');
        expect(parsed.messages[0]?.kind).toBe('unknown');
    });
});

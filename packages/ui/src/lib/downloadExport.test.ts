import { describe, expect, it } from 'vitest';
import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';
import { parseExport } from '@acp-devtools/core/storage/export';
import { buildExportJson, exportFilename } from './downloadExport';

const session: SessionRecord = {
    id: 42,
    name: null,
    agentCommand: 'npx -y @zed-industries/claude-code-acp',
    clientName: 'Zed',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    importedAt: null,
};

const message: CapturedMessage = {
    seq: 1,
    timestamp: 1_700_000_000_500,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: 1,
    raw: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
};

describe('exportFilename', () => {
    it('builds a stable filename with session id and timestamp', () => {
        const name = exportFilename(session, Date.UTC(2026, 4, 27, 18, 34, 6));
        expect(name).toBe('acp-session-42-2026-05-27-18-34-06.json');
    });

    it("uses 'live' when session has no persisted id", () => {
        const ephemeral: SessionRecord = { ...session, id: 0 };
        expect(exportFilename(ephemeral, Date.UTC(2026, 4, 27, 18, 34, 6))).toMatch(
            /^acp-session-live-/,
        );
    });
});

describe('buildExportJson', () => {
    it('produces a parseable SessionExport carrying every message', () => {
        const json = buildExportJson(session, [message], Date.UTC(2026, 4, 27));
        const parsed = parseExport(json);
        expect(parsed.session.id).toBe(42);
        expect(parsed.session.clientName).toBe('Zed');
        expect(parsed.tool.name).toBe('acp-devtools-ui');
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0]?.raw).toBe(message.raw);
    });
});

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
    clientVersion: null,
    clientPlatform: null,
    agentName: null,
    agentVersion: null,
    protocolVersion: null,
    currentMode: null,
    currentModel: null,
    agentCapabilitiesJson: null,
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

    it('redacts WebStorm proxy_key tokens by default (UI has no --raw escape)', () => {
        const secret = 'jetbrains-token-must-not-leak';
        const payload = {
            jsonrpc: '2.0' as const,
            id: 1,
            method: 'initialize',
            params: {
                _meta: {
                    proxyConfig: {
                        proxies: [
                            {
                                proxy: {
                                    url: 'http://127.0.0.1:50001',
                                    headers: { proxy_key: secret },
                                },
                            },
                        ],
                    },
                },
            },
        };
        const msg: CapturedMessage = {
            seq: 1,
            timestamp: 1_700_000_000_500,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'initialize',
            rpcId: 1,
            raw: JSON.stringify(payload),
            payload,
        };

        const json = buildExportJson(session, [msg], Date.UTC(2026, 4, 27));
        expect(json).not.toContain(secret);
        expect(json).toContain('<REDACTED>');
    });
});

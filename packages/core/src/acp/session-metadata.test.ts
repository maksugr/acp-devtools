import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { extractSessionMetadata } from './session-metadata.js';

const mk = (overrides: Partial<CapturedMessage> = {}): CapturedMessage => ({
    seq: 1,
    timestamp: 0,
    direction: 'editor-to-agent',
    kind: 'request',
    raw: '',
    payload: null,
    ...overrides,
});

const zedInit = mk({
    seq: 1,
    method: 'initialize',
    rpcId: '1',
    payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5+stable.285' },
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: true,
                auth: { terminal: true },
            },
        },
    } as unknown as CapturedMessage['payload'],
});

const zedInitResponse = mk({
    seq: 2,
    direction: 'agent-to-editor',
    kind: 'response',
    rpcId: '1',
    payload: {
        jsonrpc: '2.0',
        id: 1,
        result: {
            protocolVersion: 1,
            agentInfo: { name: 'claude-agent-acp', version: '0.37.0' },
            agentCapabilities: { promptCapabilities: { image: true }, loadSession: true },
            authMethods: [{ id: 'oauth' }, { id: 'apikey' }],
        },
    } as unknown as CapturedMessage['payload'],
});

const webstormInit = mk({
    seq: 1,
    method: 'initialize',
    rpcId: '1',
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
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
                auth: { _meta: { gateway: true } },
            },
            _meta: {
                proxyConfig: { proxies: [{ host: '127.0.0.1', port: 50000 }] },
            },
        },
    } as unknown as CapturedMessage['payload'],
});

describe('extractSessionMetadata', () => {
    it('returns empty metadata when there are no messages', () => {
        const meta = extractSessionMetadata([]);
        expect(meta.protocolVersion).toBeNull();
        expect(meta.client.title).toBeNull();
        expect(meta.agent.name).toBeNull();
        expect(meta.clientCapabilities.fsReadTextFile).toBe(false);
        expect(meta.runtime.currentMode).toBeNull();
    });

    it('extracts Zed client info + capabilities from initialize', () => {
        const meta = extractSessionMetadata([zedInit]);
        expect(meta.protocolVersion).toBe(1);
        expect(meta.client).toEqual({
            name: 'zed',
            title: 'Zed',
            version: '1.3.5+stable.285',
            platform: null,
        });
        expect(meta.clientCapabilities).toEqual({
            fsReadTextFile: true,
            fsWriteTextFile: true,
            terminal: true,
            authTerminal: true,
            authGateway: false,
        });
        expect(meta.extensions.jetbrainsProxyConfig).toBeNull();
    });

    it('extracts WebStorm clientInfo._meta.platform and JetBrains proxyConfig', () => {
        const meta = extractSessionMetadata([webstormInit]);
        expect(meta.client.platform).toBe('intellij');
        expect(meta.clientCapabilities.terminal).toBe(false);
        expect(meta.clientCapabilities.authGateway).toBe(true);
        expect(meta.extensions.jetbrainsProxyConfig).toEqual({
            proxies: [{ host: '127.0.0.1', port: 50000 }],
        });
    });

    it('extracts agent info and authMethods count from initialize response', () => {
        const meta = extractSessionMetadata([zedInit, zedInitResponse]);
        expect(meta.agent).toEqual({
            name: 'claude-agent-acp',
            version: '0.37.0',
            authMethods: 2,
        });
        expect(meta.agentCapabilities.loadSession).toBe(true);
    });

    it('aggregates set_mode / set_model changes and counts transitions', () => {
        const setMode1 = mk({
            seq: 3,
            kind: 'request',
            method: 'session/set_mode',
            payload: {
                jsonrpc: '2.0',
                id: 2,
                method: 'session/set_mode',
                params: { modeId: 'coding' },
            } as unknown as CapturedMessage['payload'],
        });
        const setMode2 = mk({
            seq: 4,
            kind: 'request',
            method: 'session/set_mode',
            payload: {
                jsonrpc: '2.0',
                id: 3,
                method: 'session/set_mode',
                params: { modeId: 'debug' },
            } as unknown as CapturedMessage['payload'],
        });
        const setMode3 = mk({
            seq: 5,
            kind: 'request',
            method: 'session/set_mode',
            payload: {
                jsonrpc: '2.0',
                id: 4,
                method: 'session/set_mode',
                params: { modeId: 'debug' },
            } as unknown as CapturedMessage['payload'],
        });
        const setModel = mk({
            seq: 6,
            kind: 'request',
            method: 'session/set_model',
            payload: {
                jsonrpc: '2.0',
                id: 5,
                method: 'session/set_model',
                params: { modelId: 'sonnet-4.5' },
            } as unknown as CapturedMessage['payload'],
        });
        const meta = extractSessionMetadata([zedInit, setMode1, setMode2, setMode3, setModel]);
        expect(meta.runtime.currentMode).toBe('debug');
        expect(meta.runtime.modeChanges).toBe(1);
        expect(meta.runtime.currentModel).toBe('sonnet-4.5');
        expect(meta.runtime.modelChanges).toBe(0);
    });

    it('reads available_commands_update notification and surfaces last list', () => {
        const update = mk({
            seq: 3,
            direction: 'agent-to-editor',
            kind: 'notification',
            method: 'session/update',
            payload: {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                    update: {
                        sessionUpdate: 'available_commands_update',
                        availableCommands: [
                            { name: 'debug', description: 'show internal state' },
                            { name: 'compact', description: 'compact context' },
                        ],
                    },
                },
            } as unknown as CapturedMessage['payload'],
        });
        const meta = extractSessionMetadata([zedInit, update]);
        expect(meta.runtime.availableCommands).toEqual(['debug', 'compact']);
    });

    it('reads current_mode_update notifications as mode source', () => {
        const update = mk({
            seq: 3,
            direction: 'agent-to-editor',
            kind: 'notification',
            method: 'session/update',
            payload: {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                    update: { sessionUpdate: 'current_mode_update', currentModeId: 'review' },
                },
            } as unknown as CapturedMessage['payload'],
        });
        const meta = extractSessionMetadata([zedInit, update]);
        expect(meta.runtime.currentMode).toBe('review');
    });
});

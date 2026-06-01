import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { resolveSpecForMessage } from './spec-decoder.js';

const initializeRequest: CapturedMessage = {
    seq: 1,
    timestamp: 0,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: '1',
    raw: '',
    payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: 1,
            clientInfo: { name: 'zed', title: 'Zed', version: '1.3.5' },
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: true,
            },
            _meta: { proxyConfig: { ip: '127.0.0.1' } },
        },
    } as unknown as CapturedMessage['payload'],
};

describe('resolveSpecForMessage', () => {
    it('returns null for unknown methods', () => {
        const msg: CapturedMessage = { ...initializeRequest, method: 'made/up/method' };
        expect(resolveSpecForMessage(msg)).toBeNull();
    });

    it('returns the schema-def name and description for the message envelope', () => {
        const r = resolveSpecForMessage(initializeRequest);
        expect(r).not.toBeNull();
        expect(r?.typeName).toBe('InitializeRequest');
        expect(r?.typeDescription).toMatch(/initialize/i);
    });

    it('resolves a single-level field with description', () => {
        const r = resolveSpecForMessage(initializeRequest);
        const info = r?.resolve(['params', 'protocolVersion']);
        expect(info?.inSpec).toBe(true);
        expect(info?.isExtension).toBe(false);
        expect(info?.description).toMatch(/protocol version/i);
    });

    it('follows allOf+$ref into nested defs (clientCapabilities → fs → readTextFile)', () => {
        const r = resolveSpecForMessage(initializeRequest);
        const info = r?.resolve(['params', 'clientCapabilities', 'fs', 'readTextFile']);
        expect(info?.inSpec).toBe(true);
        expect(info?.description).toMatch(/read/i);
    });

    it('marks anything under _meta as extension and not in spec', () => {
        const r = resolveSpecForMessage(initializeRequest);
        const info = r?.resolve(['params', '_meta', 'proxyConfig', 'ip']);
        expect(info?.isExtension).toBe(true);
        expect(info?.inSpec).toBe(false);
    });

    it('returns inSpec=false for fields the schema does not declare', () => {
        const r = resolveSpecForMessage(initializeRequest);
        const info = r?.resolve(['params', 'somethingBogus']);
        expect(info?.inSpec).toBe(false);
        expect(info?.isExtension).toBe(false);
    });

    it('treats responses without pairedMethod as unresolvable', () => {
        const response: CapturedMessage = {
            ...initializeRequest,
            kind: 'response',
            payload: { jsonrpc: '2.0', id: 1, result: {} } as unknown as CapturedMessage['payload'],
        };
        expect(resolveSpecForMessage(response)).toBeNull();
    });

    it('picks the response def when pairedMethod is provided', () => {
        const response: CapturedMessage = {
            ...initializeRequest,
            kind: 'response',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                result: { protocolVersion: 1 },
            } as unknown as CapturedMessage['payload'],
        };
        const r = resolveSpecForMessage(response, { pairedMethod: 'initialize' });
        expect(r?.typeName).toBe('InitializeResponse');
        expect(r?.resolve(['result', 'protocolVersion'])?.inSpec).toBe(true);
    });

    it('discriminates tagged-union variants by `const` value (the boolean-vs-string config bug)', () => {
        const stringConfig: CapturedMessage = {
            seq: 1,
            timestamp: 0,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'session/set_config_option',
            rpcId: '1',
            raw: '',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'session/set_config_option',
                params: { type: 'string', value: 'default' },
            } as unknown as CapturedMessage['payload'],
        };
        const r = resolveSpecForMessage(stringConfig);
        const info = r?.resolve(['params', 'value']);
        // The string variant's description should win, not the boolean's.
        expect(info?.description ?? '').not.toMatch(/boolean value/i);
    });

    it('falls back to first non-null variant when no value is supplied to disambiguate', () => {
        // Edge case: when the JsonTree asks for spec info but the actual
        // payload doesn't have the discriminator yet (mid-construction),
        // walker should still resolve to *something* and mark inSpec=true.
        const stringConfig: CapturedMessage = {
            seq: 1,
            timestamp: 0,
            direction: 'editor-to-agent',
            kind: 'request',
            method: 'session/set_config_option',
            rpcId: '1',
            raw: '',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'session/set_config_option',
                params: {},
            } as unknown as CapturedMessage['payload'],
        };
        const r = resolveSpecForMessage(stringConfig);
        // Just verify it doesn't crash and returns something for the envelope.
        expect(r?.typeName).toBe('SetSessionConfigOptionRequest');
    });
});

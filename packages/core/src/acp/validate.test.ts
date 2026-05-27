import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { knownAcpMethods, validateAcpMessage } from './validate.js';

function mk(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq: 1,
        timestamp: 0,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: 1,
        raw: '',
        payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: 1, clientCapabilities: {} },
        },
        ...overrides,
    };
}

describe('validateAcpMessage', () => {
    it('passes for a minimal valid initialize request', () => {
        const r = validateAcpMessage(mk());
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
        expect(r.schemaName).toBe('InitializeRequest');
    });

    it('reports a missing required property with ajv error shape', () => {
        const r = validateAcpMessage(
            mk({
                payload: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {}, // protocolVersion is required by the spec
                },
            }),
        );
        expect(r.valid).toBe(false);
        expect(r.schemaName).toBe('InitializeRequest');
        expect(r.errors[0]?.keyword).toBe('required');
        expect(r.errors[0]?.message).toMatch(/protocolVersion/);
    });

    it('skips messages whose method the spec does not know about', () => {
        const r = validateAcpMessage(
            mk({
                method: 'made/up/method',
                payload: { jsonrpc: '2.0', id: 1, method: 'made/up/method', params: {} },
            }),
        );
        expect(r.valid).toBe(true);
        expect(r.skipped).toBe('unknown-method');
    });

    it('skips frames with a parseError (already flagged upstream)', () => {
        const r = validateAcpMessage(
            mk({ payload: null, parseError: 'invalid JSON', kind: 'unknown' }),
        );
        expect(r.valid).toBe(true);
        expect(r.skipped).toBe('parse-error');
    });

    it('skips notifications when there is no x-method match', () => {
        const r = validateAcpMessage(
            mk({
                kind: 'notification',
                method: 'never/heard/of/this',
                rpcId: undefined,
                payload: { jsonrpc: '2.0', method: 'never/heard/of/this', params: {} },
            }),
        );
        expect(r.valid).toBe(true);
        expect(r.skipped).toBe('unknown-method');
    });

    it('validates responses when pairedMethod is supplied', () => {
        const responseRaw = mk({
            direction: 'agent-to-editor',
            kind: 'response',
            method: undefined,
            rpcId: 1,
            payload: {
                jsonrpc: '2.0',
                id: 1,
                result: {
                    protocolVersion: 1,
                    agentCapabilities: { promptCapabilities: {} },
                    authMethods: [],
                },
            },
        });
        const r = validateAcpMessage(responseRaw, { pairedMethod: 'initialize' });
        expect(r.valid).toBe(true);
        expect(r.schemaName).toBe('InitializeResponse');
    });

    it('skips responses with no pairedMethod (the JSON-RPC frame carries only the id)', () => {
        const r = validateAcpMessage(
            mk({
                kind: 'response',
                method: undefined,
                rpcId: 1,
                payload: { jsonrpc: '2.0', id: 1, result: {} },
            }),
        );
        expect(r.valid).toBe(true);
        expect(r.skipped).toBe('no-method');
    });

    it('skips frames whose kind is `unknown` or `error` (no per-method schema)', () => {
        const errFrame = mk({
            kind: 'error',
            method: undefined,
            payload: {
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32600, message: 'Invalid Request' },
            },
        });
        // Even with a pairedMethod, error frames don't have an ACP-side schema —
        // their shape is fully covered by the JSON-RPC envelope which the
        // parser already enforces.
        const r = validateAcpMessage(errFrame, { pairedMethod: 'initialize' });
        expect(r.valid).toBe(true);
        expect(r.skipped).toBe('wrong-kind');
    });
});

describe('knownAcpMethods', () => {
    it('lists at least the core handshake + session lifecycle methods', () => {
        const names = new Set(knownAcpMethods());
        expect(names.has('initialize')).toBe(true);
        expect(names.has('session/new')).toBe(true);
        expect(names.has('session/prompt')).toBe(true);
        expect(names.has('session/update')).toBe(true);
    });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { knownAcpMethods, validateAcpMessage, validateMessages } from './validate.js';

// Real ACP v2 traffic recorded from the SDK's reference client and agent
// (fixtures/generate-v2-session.mjs).
const v2Session = (
    JSON.parse(readFileSync(join(process.cwd(), 'fixtures/v2-session.json'), 'utf8')) as {
        messages: CapturedMessage[];
    }
).messages;

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

describe('soon-required advisories', () => {
    const initResult = (result: Record<string, unknown>) =>
        validateAcpMessage(
            mk({
                direction: 'agent-to-editor',
                kind: 'response',
                method: undefined,
                rpcId: 1,
                payload: { jsonrpc: '2.0', id: 1, result },
            }),
            { pairedMethod: 'initialize' },
        );

    it('flags a valid initialize response missing agentInfo', () => {
        const r = initResult({
            protocolVersion: 1,
            agentCapabilities: { promptCapabilities: {} },
            authMethods: [],
        });
        expect(r.valid).toBe(true);
        expect(r.advisories).toEqual([
            {
                path: 'agentInfo',
                kind: 'soon-required',
                message: 'missing agentInfo — will be required in a future ACP version',
            },
        ]);
    });

    it('treats an explicit null agentInfo as missing', () => {
        const r = initResult({
            protocolVersion: 1,
            agentCapabilities: { promptCapabilities: {} },
            authMethods: [],
            agentInfo: null,
        });
        expect(r.advisories?.[0]?.path).toBe('agentInfo');
    });

    it('emits no advisory once agentInfo is present', () => {
        const r = initResult({
            protocolVersion: 1,
            agentCapabilities: { promptCapabilities: {} },
            authMethods: [],
            agentInfo: { name: 'goose', version: '1.37.0' },
        });
        expect(r.valid).toBe(true);
        expect(r.advisories).toBeUndefined();
    });

    it('flags an initialize request missing clientInfo (editor side)', () => {
        const r = validateAcpMessage(
            mk({
                payload: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { protocolVersion: 1, clientCapabilities: {} },
                },
            }),
        );
        expect(r.valid).toBe(true);
        expect(r.advisories?.[0]?.path).toBe('clientInfo');
    });

    it('carries advisories alongside hard violations', () => {
        const r = initResult({});
        expect(r.valid).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.advisories?.some((a) => a.path === 'agentInfo')).toBe(true);
    });
});

describe('validateAcpMessage — protocol versions', () => {
    const v2Initialize = v2Session.find((m) => m.method === 'initialize')!;

    it('validates against the requested version and reports it', () => {
        const r = validateAcpMessage(v2Initialize, { protocolVersion: 2 });
        expect(r).toMatchObject({
            valid: true,
            schemaName: 'InitializeRequest',
            protocolVersion: 2,
        });
    });

    it('flags a v2 frame read with the v1 schema', () => {
        // A v2 prompt response carries `messageId` and no `stopReason`, which
        // v1 requires.
        const promptResponse = v2Session.find(
            (m) =>
                m.kind === 'response' &&
                (m.payload as { result?: { messageId?: unknown } }).result?.messageId !== undefined,
        )!;
        const opts = { pairedMethod: 'session/prompt' };
        expect(validateAcpMessage(promptResponse, { ...opts, protocolVersion: 2 }).valid).toBe(
            true,
        );
        expect(validateAcpMessage(promptResponse, { ...opts, protocolVersion: 1 }).valid).toBe(
            false,
        );
    });

    it('defaults to v1', () => {
        expect(validateAcpMessage(mk()).protocolVersion).toBe(1);
    });

    it('skips a version it has no schema for', () => {
        const r = validateAcpMessage(mk(), { protocolVersion: 99 });
        expect(r).toMatchObject({
            valid: true,
            skipped: 'unsupported-protocol-version',
            protocolVersion: 99,
        });
    });
});

describe('validateMessages', () => {
    it('reads a v2 session with the v2 schema, every frame valid', () => {
        const results = validateMessages(v2Session);
        expect(results.size).toBe(v2Session.length);
        for (const r of results.values()) {
            expect(r.skipped).toBeUndefined();
            expect(r.valid).toBe(true);
            expect(r.protocolVersion).toBe(2);
        }
    });

    it("gives each response its request's method", () => {
        const results = validateMessages(v2Session);
        const permissionReply = v2Session.find(
            (m) =>
                m.kind === 'response' &&
                m.direction === 'editor-to-agent' &&
                (m.payload as { result?: { outcome?: unknown } })?.result?.outcome,
        )!;
        expect(results.get(permissionReply.seq)).toMatchObject({
            method: 'session/request_permission',
            schemaName: 'RequestPermissionResponse',
        });
    });

    it('reads a session without initialize as v1', () => {
        const prompt = mk({
            method: 'session/prompt',
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'session/prompt',
                params: { sessionId: 's', prompt: [{ type: 'text', text: 'hi' }] },
            },
        });
        expect(validateMessages([prompt]).get(1)).toMatchObject({
            valid: true,
            protocolVersion: 1,
        });
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

    it("follows each version's method set", () => {
        const v1 = new Set(knownAcpMethods(1));
        const v2 = new Set(knownAcpMethods(2));
        expect(v1.has('fs/read_text_file')).toBe(true);
        expect(v2.has('fs/read_text_file')).toBe(false);
        expect(v2.has('auth/login')).toBe(true);
        expect(v2.has('tool_call/cancel')).toBe(true);
        expect(knownAcpMethods(99)).toEqual([]);
    });
});

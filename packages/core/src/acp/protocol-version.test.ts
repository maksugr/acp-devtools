import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PROTOCOL_VERSION,
    detectProtocolVersion,
    frameProtocolVersion,
    isSupportedProtocolVersion,
} from './protocol-version.js';
import type { CapturedMessage } from './types.js';

let seq = 0;
function initRequest(id: number, protocolVersion: number): CapturedMessage {
    seq += 1;
    const payload = {
        jsonrpc: '2.0' as const,
        id,
        method: 'initialize',
        params: { protocolVersion },
    };
    return {
        seq,
        timestamp: seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: id,
        raw: JSON.stringify(payload),
        payload,
    };
}
function initResponse(id: number, protocolVersion: number): CapturedMessage {
    seq += 1;
    const payload = { jsonrpc: '2.0' as const, id, result: { protocolVersion } };
    return {
        seq,
        timestamp: seq,
        direction: 'agent-to-editor',
        kind: 'response',
        rpcId: id,
        raw: JSON.stringify(payload),
        payload,
    };
}
function prompt(id: number): CapturedMessage {
    seq += 1;
    const payload = { jsonrpc: '2.0' as const, id, method: 'session/prompt', params: {} };
    return {
        seq,
        timestamp: seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'session/prompt',
        rpcId: id,
        raw: JSON.stringify(payload),
        payload,
    };
}

describe('detectProtocolVersion', () => {
    it('is null without an initialize exchange', () => {
        expect(detectProtocolVersion([prompt(1)])).toBeNull();
    });

    it('takes the version the agent answered with', () => {
        expect(detectProtocolVersion([initRequest(0, 2), initResponse(0, 2)])).toBe(2);
        expect(detectProtocolVersion([initRequest(0, 2), initResponse(0, 1)])).toBe(1);
    });

    it('uses the last initialize when the client falls back', () => {
        const messages = [
            initRequest(0, 2),
            initResponse(0, 1),
            initRequest(1, 1),
            initResponse(1, 1),
            prompt(2),
        ];
        expect(detectProtocolVersion(messages)).toBe(1);
    });

    it('falls back to the requested version when the response is missing', () => {
        expect(detectProtocolVersion([initRequest(0, 2)])).toBe(2);
    });

    it('ignores a later reply that reuses a completed initialize id', () => {
        const reused = initResponse(0, 9);
        expect(
            detectProtocolVersion([initRequest(0, 2), initResponse(0, 2), prompt(0), reused]),
        ).toBe(2);
    });

    it('ignores an agent response that answers a different request', () => {
        expect(detectProtocolVersion([initRequest(0, 2), initResponse(7, 1)])).toBe(2);
    });
});

describe('frameProtocolVersion', () => {
    it('reads initialize frames with the version they declare', () => {
        expect(frameProtocolVersion(initRequest(0, 2), 1)).toBe(2);
        expect(frameProtocolVersion(initResponse(0, 2), 1, 'initialize')).toBe(2);
    });

    it('reads every other frame with the session version', () => {
        expect(frameProtocolVersion(prompt(1), 2)).toBe(2);
    });

    it('assumes the default version when the session version is unknown', () => {
        expect(frameProtocolVersion(prompt(1), null)).toBe(DEFAULT_PROTOCOL_VERSION);
    });
});

describe('isSupportedProtocolVersion', () => {
    it('accepts the versions acp-devtools has schemas for', () => {
        expect(isSupportedProtocolVersion(1)).toBe(true);
        expect(isSupportedProtocolVersion(2)).toBe(true);
        expect(isSupportedProtocolVersion(3)).toBe(false);
        expect(isSupportedProtocolVersion('2')).toBe(false);
    });
});

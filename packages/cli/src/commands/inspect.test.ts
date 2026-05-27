import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from '@acp-devtools/core';
import { buildPairIndex, formatLatency } from './inspect.js';

function mkMsg(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq * 1000,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{}',
        payload: null,
        ...overrides,
    };
}

describe('buildPairIndex', () => {
    it('returns empty for no messages', () => {
        expect(buildPairIndex([])).toEqual(new Map());
    });

    it('skips notifications and messages with no rpcId', () => {
        const msgs = [
            mkMsg(1, { kind: 'notification', method: 'session/update', rpcId: undefined }),
            mkMsg(2, { rpcId: null }),
        ];
        expect(buildPairIndex(msgs).size).toBe(0);
    });

    it('matches a request with its response and sets latency on both seqs', () => {
        const msgs = [
            mkMsg(1, { kind: 'request', method: 'initialize', rpcId: 'r1', timestamp: 1000 }),
            mkMsg(2, { kind: 'response', method: undefined, rpcId: 'r1', timestamp: 1500, direction: 'agent-to-editor' }),
        ];
        const idx = buildPairIndex(msgs);
        expect(idx.get(1)).toEqual({ pairSeq: 2, latencyMs: 500 });
        expect(idx.get(2)).toEqual({ pairSeq: 1, latencyMs: 500 });
    });

    it('pairs errors the same way as responses', () => {
        const msgs = [
            mkMsg(1, { kind: 'request', rpcId: 'x', timestamp: 1000 }),
            mkMsg(2, { kind: 'error', rpcId: 'x', timestamp: 1230, direction: 'agent-to-editor' }),
        ];
        const idx = buildPairIndex(msgs);
        expect(idx.get(1)?.pairSeq).toBe(2);
        expect(idx.get(2)?.latencyMs).toBe(230);
    });

    it('clamps a negative latency to zero (clock skew safety)', () => {
        const msgs = [
            mkMsg(1, { kind: 'request', rpcId: 'a', timestamp: 5000 }),
            mkMsg(2, { kind: 'response', rpcId: 'a', timestamp: 4000, direction: 'agent-to-editor' }),
        ];
        expect(buildPairIndex(msgs).get(1)?.latencyMs).toBe(0);
    });

    it('drops orphan responses with no matching request', () => {
        const msgs = [mkMsg(1, { kind: 'response', rpcId: 'lonely', method: undefined })];
        expect(buildPairIndex(msgs).size).toBe(0);
    });

    it('overwrites with later request when rpcId is reused', () => {
        const msgs = [
            mkMsg(1, { kind: 'request', rpcId: 'r', timestamp: 1000 }),
            mkMsg(2, { kind: 'request', rpcId: 'r', timestamp: 2000 }),
            mkMsg(3, { kind: 'response', rpcId: 'r', timestamp: 2300, direction: 'agent-to-editor' }),
        ];
        const idx = buildPairIndex(msgs);
        // The second request is the one paired — matches UI's buildRequestIndex.
        expect(idx.get(2)?.pairSeq).toBe(3);
        expect(idx.get(3)?.pairSeq).toBe(2);
        expect(idx.has(1)).toBe(false);
    });
});

describe('formatLatency', () => {
    it('uses ms below 1 second', () => {
        expect(formatLatency(0)).toBe('0ms');
        expect(formatLatency(935)).toBe('935ms');
    });
    it('two-decimal seconds below 10s', () => {
        expect(formatLatency(1000)).toBe('1.00s');
        expect(formatLatency(4234)).toBe('4.23s');
    });
    it('one-decimal seconds up to a minute', () => {
        expect(formatLatency(10_000)).toBe('10.0s');
        expect(formatLatency(59_500)).toBe('59.5s');
    });
    it('minutes + seconds above a minute', () => {
        expect(formatLatency(60_000)).toBe('1m0s');
        expect(formatLatency(125_000)).toBe('2m5s');
    });
});

import { describe, expect, it } from 'vitest';
import type { CapturedMessage, SessionRecord } from '@acp-devtools/core';
import { computeStats, formatLatency, percentile } from './stats.js';

const session: SessionRecord = {
    id: 1,
    name: null,
    agentCommand: 'mock',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    clientName: 'Zed',
    importedAt: null,
};

function mk(seq: number, overrides: Partial<CapturedMessage> = {}): CapturedMessage {
    return {
        seq,
        timestamp: 1_700_000_000_000 + seq,
        direction: 'editor-to-agent',
        kind: 'request',
        method: 'initialize',
        rpcId: seq,
        raw: '{}',
        payload: null,
        ...overrides,
    };
}

describe('percentile', () => {
    it('returns 0 for empty arrays', () => {
        expect(percentile([], 50)).toBe(0);
    });
    it('returns the only sample for a single-element array', () => {
        expect(percentile([42], 99)).toBe(42);
    });
    it('matches the UI linear-interpolation form', () => {
        const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        // rank = (p/100) * (n-1) = 0.5 * 9 = 4.5 → interp between xs[4]=5 and xs[5]=6 → 5.5
        expect(percentile(xs, 50)).toBeCloseTo(5.5, 5);
        // 0.9 * 9 = 8.1 → between xs[8]=9 and xs[9]=10 at offset 0.1 → 9.1
        expect(percentile(xs, 90)).toBeCloseTo(9.1, 5);
        // 0.99 * 9 = 8.91 → between xs[8] and xs[9] at 0.91 → 9.91
        expect(percentile(xs, 99)).toBeCloseTo(9.91, 5);
    });
    it('uses interpolation for two-sample input — p50 of [500,2000] is 1250', () => {
        expect(percentile([500, 2000], 50)).toBe(1250);
    });
});

describe('formatLatency', () => {
    it('switches scale by magnitude', () => {
        expect(formatLatency(0)).toBe('0ms');
        expect(formatLatency(999)).toBe('999ms');
        expect(formatLatency(1234)).toBe('1.23s');
        expect(formatLatency(45_000)).toBe('45.0s');
        expect(formatLatency(125_000)).toBe('2m5s');
    });
});

describe('computeStats', () => {
    it('returns zero stats for an empty session', () => {
        const s = computeStats(session, []);
        expect(s.total).toBe(0);
        expect(s.direction).toEqual({ editorToAgent: 0, agentToEditor: 0 });
        expect(s.kind).toEqual({ request: 0, response: 0, notification: 0, error: 0, unknown: 0 });
        expect(s.latency.sampleSize).toBe(0);
        expect(s.latency.p50).toBeNull();
        expect(s.perMethod).toEqual([]);
    });

    it('counts directions and kinds, computes latency on req/rsp pairs', () => {
        const msgs: CapturedMessage[] = [
            mk(1, { kind: 'request', rpcId: 'a', timestamp: 1000, method: 'initialize' }),
            mk(2, {
                kind: 'response',
                rpcId: 'a',
                timestamp: 1500,
                direction: 'agent-to-editor',
                method: undefined,
            }),
            mk(3, {
                kind: 'notification',
                rpcId: undefined,
                method: 'session/update',
                direction: 'agent-to-editor',
                timestamp: 1600,
            }),
            mk(4, { kind: 'request', rpcId: 'b', timestamp: 2000, method: 'session/prompt' }),
            mk(5, {
                kind: 'response',
                rpcId: 'b',
                timestamp: 4000,
                direction: 'agent-to-editor',
                method: undefined,
            }),
        ];
        const s = computeStats(session, msgs);
        expect(s.total).toBe(5);
        expect(s.direction).toEqual({ editorToAgent: 2, agentToEditor: 3 });
        expect(s.kind.request).toBe(2);
        expect(s.kind.response).toBe(2);
        expect(s.kind.notification).toBe(1);
        expect(s.latency.sampleSize).toBe(2);
        // interpolated p50 of [500, 2000] = 1250
        expect(s.latency.p50).toBe(1250);
        expect(s.latency.max).toBe(2000);
        expect(s.latency.mean).toBe(1250);
    });

    it('groups per-method by request first, then notification, with stable count desc', () => {
        const msgs: CapturedMessage[] = [
            mk(1, { kind: 'request', rpcId: '1', method: 'session/prompt', timestamp: 1000 }),
            mk(2, { kind: 'response', rpcId: '1', timestamp: 2000, direction: 'agent-to-editor' }),
            mk(3, { kind: 'request', rpcId: '2', method: 'session/prompt', timestamp: 3000 }),
            mk(4, { kind: 'response', rpcId: '2', timestamp: 3500, direction: 'agent-to-editor' }),
            mk(5, { kind: 'request', rpcId: '3', method: 'initialize', timestamp: 100 }),
            mk(6, { kind: 'response', rpcId: '3', timestamp: 200, direction: 'agent-to-editor' }),
            mk(7, {
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                direction: 'agent-to-editor',
            }),
            mk(8, {
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                direction: 'agent-to-editor',
            }),
            mk(9, {
                kind: 'notification',
                method: 'session/update',
                rpcId: undefined,
                direction: 'agent-to-editor',
            }),
        ];
        const s = computeStats(session, msgs);
        expect(s.perMethod.map((r) => `${r.method}:${r.kind}:${r.count}`)).toEqual([
            'session/update:notification:3', // most common
            'session/prompt:request:2',
            'initialize:request:1',
        ]);
        const prompt = s.perMethod.find((r) => r.method === 'session/prompt')!;
        expect(prompt.sampleSize).toBe(2);
        expect(prompt.totalLatencyMs).toBe(1500); // 1000 + 500
    });

    it('counts parse errors', () => {
        const msgs: CapturedMessage[] = [
            mk(1, { kind: 'unknown', method: undefined, parseError: 'invalid JSON', raw: '{junk' }),
        ];
        const s = computeStats(session, msgs);
        expect(s.parseErrors).toBe(1);
        expect(s.kind.unknown).toBe(1);
    });
});

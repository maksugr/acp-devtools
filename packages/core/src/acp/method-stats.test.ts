import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import { buildPairIndex, buildPerMethodStats, mean, percentile } from './method-stats.js';

const mk = (overrides: Partial<CapturedMessage> & { seq: number }): CapturedMessage => ({
    timestamp: 1_700_000_000_000 + overrides.seq * 1000,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: overrides.seq,
    raw: '{}',
    payload: null,
    ...overrides,
});

describe('buildPairIndex (core re-home)', () => {
    it('pairs request with response by rpcId, both seqs reference the same latency', () => {
        const req = mk({ seq: 1, rpcId: 'x' });
        const rsp = mk({
            seq: 2,
            rpcId: 'x',
            kind: 'response',
            direction: 'agent-to-editor',
            timestamp: req.timestamp + 250,
        });
        const idx = buildPairIndex([req, rsp]);
        expect(idx.get(1)).toEqual({ pairSeq: 2, latencyMs: 250 });
        expect(idx.get(2)).toEqual({ pairSeq: 1, latencyMs: 250 });
    });

    it('clamps negative latency to zero (clock skew)', () => {
        const req = mk({ seq: 1, rpcId: 'x' });
        const rsp = mk({
            seq: 2,
            rpcId: 'x',
            kind: 'response',
            direction: 'agent-to-editor',
            timestamp: req.timestamp - 50,
        });
        expect(buildPairIndex([req, rsp]).get(1)?.latencyMs).toBe(0);
    });
});

describe('percentile (core re-home)', () => {
    it('returns 0 for an empty array', () => {
        expect(percentile([], 50)).toBe(0);
    });
    it('returns the single value for any percentile', () => {
        expect(percentile([42], 99)).toBe(42);
    });
    it('interpolates linearly between samples without rounding', () => {
        const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(percentile(xs, 50)).toBeCloseTo(5.5, 5);
        expect(percentile(xs, 99)).toBeCloseTo(9.91, 5);
    });
});

describe('mean (core re-home)', () => {
    it('returns 0 for empty input', () => {
        expect(mean([])).toBe(0);
    });
    it('computes arithmetic mean', () => {
        expect(mean([2, 4, 6])).toBe(4);
    });
});

describe('buildPerMethodStats', () => {
    it('groups by method, counts requests and notifications separately', () => {
        const msgs: CapturedMessage[] = [
            mk({ seq: 1, method: 'initialize', rpcId: 1 }),
            mk({
                seq: 2,
                method: 'initialize',
                rpcId: 1,
                kind: 'response',
                direction: 'agent-to-editor',
                timestamp: mk({ seq: 1 }).timestamp + 100,
            }),
            mk({ seq: 3, method: 'session/prompt', rpcId: 2 }),
            mk({
                seq: 4,
                method: 'session/prompt',
                rpcId: 2,
                kind: 'response',
                direction: 'agent-to-editor',
                timestamp: mk({ seq: 3 }).timestamp + 200,
            }),
            mk({
                seq: 5,
                method: 'session/update',
                rpcId: undefined,
                kind: 'notification',
                direction: 'agent-to-editor',
            }),
        ];
        const stats = buildPerMethodStats(msgs);
        const initialize = stats.find((s) => s.method === 'initialize' && s.kind === 'request')!;
        const prompt = stats.find((s) => s.method === 'session/prompt' && s.kind === 'request')!;
        const update = stats.find(
            (s) => s.method === 'session/update' && s.kind === 'notification',
        )!;

        expect(initialize.count).toBe(1);
        expect(initialize.p50).toBe(100);
        expect(initialize.max).toBe(100);
        expect(prompt.count).toBe(1);
        expect(prompt.p99).toBe(200);
        expect(update.count).toBe(1);
        expect(update.sampleSize).toBe(0);
        expect(update.p50).toBeNull();
    });

    it('sorts highest-count first, requests before notifications on ties', () => {
        const msgs: CapturedMessage[] = [
            mk({ seq: 1, method: 'a', kind: 'notification', rpcId: undefined }),
            mk({ seq: 2, method: 'a', kind: 'notification', rpcId: undefined }),
            mk({ seq: 3, method: 'b', rpcId: 100 }),
            mk({ seq: 4, method: 'b', rpcId: 101 }),
        ];
        const stats = buildPerMethodStats(msgs);
        expect(stats.map((s) => `${s.method}:${s.kind}`)).toEqual([
            'b:request',
            'a:notification',
        ]);
    });
});

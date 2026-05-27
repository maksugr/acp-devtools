import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from './types.js';
import type { MethodStats } from './method-stats.js';
import { buildPerformanceInsights } from './perf-insights.js';

const stat = (overrides: Partial<MethodStats> & { method: string }): MethodStats => ({
    kind: 'request',
    count: 1,
    sampleSize: 1,
    p50: 100,
    p99: 100,
    max: 100,
    totalLatencyMs: 100,
    latencies: [100],
    ...overrides,
});

const mk = (overrides: Partial<CapturedMessage> & { seq: number }): CapturedMessage => ({
    timestamp: 0,
    direction: 'editor-to-agent',
    kind: 'request',
    method: 'initialize',
    rpcId: String(overrides.seq),
    raw: '{}',
    payload: null,
    ...overrides,
});

describe('buildPerformanceInsights — hotspot', () => {
    it('flags the method that dominates total wall time (≥40%)', () => {
        const perMethod = [
            stat({ method: 'session/prompt', count: 3, totalLatencyMs: 8000, latencies: [2000, 3000, 3000], p50: 3000 }),
            stat({ method: 'fs/read', count: 10, totalLatencyMs: 200, latencies: [20], p50: 20 }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        const hotspot = insights.find((i) => i.kind === 'hotspot');
        expect(hotspot?.methods).toEqual(['session/prompt']);
        expect(hotspot?.summary).toMatch(/session\/prompt/);
    });

    it('omits hotspot when no method has ≥40% share', () => {
        const perMethod = [
            stat({ method: 'a', totalLatencyMs: 100 }),
            stat({ method: 'b', totalLatencyMs: 100 }),
            stat({ method: 'c', totalLatencyMs: 100 }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        expect(insights.find((i) => i.kind === 'hotspot')).toBeUndefined();
    });
});

describe('buildPerformanceInsights — long tail', () => {
    it('flags a method whose p99 is ≥5× the p50, with at least 3 samples', () => {
        const perMethod = [
            stat({
                method: 'fs/read_text_file',
                count: 8,
                sampleSize: 8,
                p50: 12,
                p99: 230,
                max: 230,
                latencies: [10, 11, 12, 12, 13, 14, 18, 230],
                totalLatencyMs: 320,
            }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        const tail = insights.find((i) => i.kind === 'long-tail');
        expect(tail?.methods).toEqual(['fs/read_text_file']);
        expect(tail?.summary).toMatch(/19×/);
    });

    it('skips long-tail detection when sample size is below threshold', () => {
        const perMethod = [
            stat({ method: 'x', sampleSize: 2, p50: 10, p99: 200, latencies: [10, 200] }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        expect(insights.find((i) => i.kind === 'long-tail')).toBeUndefined();
    });
});

describe('buildPerformanceInsights — busiest', () => {
    it('flags a method that dominates traffic by both absolute count and ratio', () => {
        const perMethod = [
            stat({ method: 'fs/read_text_file', count: 120, sampleSize: 0, latencies: [], p50: null, p99: null, max: null, totalLatencyMs: null }),
            stat({ method: 'initialize', count: 1 }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        const busiest = insights.find((i) => i.kind === 'busiest');
        expect(busiest?.methods).toEqual(['fs/read_text_file']);
        expect(busiest?.summary).toMatch(/120/);
    });

    it('does not flag a typical chunky session — `session/update` at 20 with no dominating ratio', () => {
        // Regression: in the screenshot, a 20-notification session triggered
        // a useless BUSIEST insight. Threshold now requires both absolute
        // count ≥50 and ≥2.5× the next-busiest method.
        const perMethod = [
            stat({ method: 'session/update', kind: 'notification', count: 20, sampleSize: 0, latencies: [], p50: null, p99: null, max: null, totalLatencyMs: null }),
            stat({ method: 'session/prompt', count: 2 }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        expect(insights.find((i) => i.kind === 'busiest')).toBeUndefined();
    });

    it('does not flag busiest when it is only marginally bigger than the runner-up', () => {
        const perMethod = [
            stat({ method: 'a', count: 60, sampleSize: 0, latencies: [], p50: null, p99: null, max: null, totalLatencyMs: null }),
            stat({ method: 'b', count: 50, sampleSize: 0, latencies: [], p50: null, p99: null, max: null, totalLatencyMs: null }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        expect(insights.find((i) => i.kind === 'busiest')).toBeUndefined();
    });
});

describe('buildPerformanceInsights — outlier', () => {
    it('flags a method where one call is ≥3× the p99', () => {
        const perMethod = [
            stat({
                method: 'session/prompt',
                count: 6,
                sampleSize: 6,
                p50: 500,
                p99: 800,
                max: 8000,
                latencies: [200, 400, 500, 600, 800, 8000],
                totalLatencyMs: 10_500,
            }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        const outlier = insights.find((i) => i.kind === 'outlier');
        expect(outlier?.methods).toEqual(['session/prompt']);
        expect(outlier?.summary).toMatch(/10×|8\.00s|10s/);
    });

    it('skips outlier when there are too few samples to establish baseline', () => {
        const perMethod = [
            stat({
                method: 'x',
                sampleSize: 3,
                p99: 100,
                max: 1000,
                latencies: [100, 100, 1000],
            }),
        ];
        const insights = buildPerformanceInsights([], perMethod);
        expect(insights.find((i) => i.kind === 'outlier')).toBeUndefined();
    });
});

describe('buildPerformanceInsights — errors', () => {
    it('attributes error frames to their paired request method', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, method: 'session/load', rpcId: '1' }),
            mk({ seq: 2, kind: 'error', rpcId: '1', direction: 'agent-to-editor', method: undefined }),
            mk({ seq: 3, method: 'session/prompt', rpcId: '2' }),
            mk({ seq: 4, kind: 'response', rpcId: '2', direction: 'agent-to-editor', method: undefined }),
        ];
        const insights = buildPerformanceInsights(messages, []);
        const err = insights.find((i) => i.kind === 'errors');
        expect(err?.methods).toEqual(['session/load']);
        expect(err?.summary).toMatch(/1 method returned an error/);
    });

    it('omits the errors insight when no kind=error frames exist', () => {
        const insights = buildPerformanceInsights([mk({ seq: 1 })], []);
        expect(insights.find((i) => i.kind === 'errors')).toBeUndefined();
    });
});

describe('buildPerformanceInsights — empty + ordering', () => {
    it('returns an empty array for no messages and no methods', () => {
        expect(buildPerformanceInsights([], [])).toEqual([]);
    });

    it('preserves hotspot → long-tail → outlier → busiest → errors ordering when all fire', () => {
        const messages: CapturedMessage[] = [
            mk({ seq: 1, method: 'session/load', rpcId: '1' }),
            mk({ seq: 2, kind: 'error', rpcId: '1', direction: 'agent-to-editor', method: undefined }),
        ];
        const perMethod = [
            // HOTSPOT — dominates wall time.
            stat({ method: 'session/prompt', count: 3, totalLatencyMs: 9000, latencies: [3000, 3000, 3000], p50: 3000 }),
            // LONG TAIL — p99 ≫ p50.
            stat({
                method: 'fs/read',
                count: 12,
                sampleSize: 12,
                p50: 10,
                p99: 200,
                max: 200,
                latencies: [10, 10, 10, 12, 12, 14, 200],
                totalLatencyMs: 280,
            }),
            // OUTLIER — one call ≫ p99.
            stat({
                method: 'session/set_model',
                count: 6,
                sampleSize: 6,
                p50: 50,
                p99: 80,
                max: 800,
                latencies: [40, 45, 50, 55, 80, 800],
                totalLatencyMs: 1070,
            }),
            // BUSIEST — large absolute count + dominates by ratio.
            stat({
                method: 'session/update',
                kind: 'notification',
                count: 200,
                sampleSize: 0,
                p50: null,
                p99: null,
                max: null,
                latencies: [],
                totalLatencyMs: null,
            }),
        ];
        const kinds = buildPerformanceInsights(messages, perMethod).map((i) => i.kind);
        expect(kinds).toEqual(['hotspot', 'long-tail', 'outlier', 'busiest', 'errors']);
    });
});

import type { CapturedMessage } from './types.js';
import type { MethodStats } from './method-stats.js';

export type InsightKind = 'hotspot' | 'long-tail' | 'outlier' | 'busiest' | 'errors';

export interface PerformanceInsight {
    kind: InsightKind;
    /** Short headline shown in the callout — single line, no markdown. */
    summary: string;
    /** Optional secondary line with the supporting numbers. */
    detail?: string;
    /** Methods this insight points at — for jump-to / filter actions. */
    methods: string[];
}

interface InsightConfig {
    /** Minimum samples a request method needs before we trust its percentiles. */
    minSamplesForTail: number;
    /** p99/p50 ratio above which a method is flagged as long-tail. */
    longTailRatio: number;
    /**
     * Absolute minimum count for BUSIEST. Set high enough that the insight
     * is genuinely informative — for ACP, `session/update` chunk noise can
     * routinely reach 20-30 per prompt, so flagging at 10 was too noisy.
     */
    minBusiestCount: number;
    /**
     * BUSIEST also requires its count be at least this multiple of the
     * second-busiest method's count. Prevents firing when several methods
     * are noisy together.
     */
    minBusiestRatio: number;
    /** Minimum hotspot share of total wall time. 0.4 means hotspot must consume ≥40% of total. */
    minHotspotShare: number;
    /**
     * Minimum samples for OUTLIER to consider a method's stats. We need
     * enough data to know the "usual" before flagging a sole stray call.
     */
    minSamplesForOutlier: number;
    /** Max/p99 ratio above which a single call counts as an outlier. */
    outlierRatio: number;
}

const DEFAULTS: InsightConfig = {
    minSamplesForTail: 3,
    longTailRatio: 5,
    minBusiestCount: 50,
    minBusiestRatio: 2.5,
    minHotspotShare: 0.4,
    minSamplesForOutlier: 5,
    outlierRatio: 3,
};

/**
 * Surface high-signal observations from a session's per-method aggregates.
 * Returns at most one insight per kind, ordered by descending importance —
 * UI renders them as a small "INSIGHTS" callout block at the top of the
 * performance panel; CLI prints them above the per-method table.
 *
 * Pure — no DB, no time, no IO. Tested via `perf-insights.test.ts`.
 */
export function buildPerformanceInsights(
    messages: CapturedMessage[],
    perMethod: MethodStats[],
    cfg: Partial<InsightConfig> = {},
): PerformanceInsight[] {
    const config = { ...DEFAULTS, ...cfg };
    const out: PerformanceInsight[] = [];

    const totalWallTime = perMethod.reduce(
        (acc, m) => acc + (m.totalLatencyMs ?? 0),
        0,
    );

    // HOTSPOT — single method consuming the largest share of measured wall time.
    if (totalWallTime > 0) {
        const ranked = perMethod
            .filter((m) => m.totalLatencyMs !== null && m.totalLatencyMs > 0)
            .sort((a, b) => (b.totalLatencyMs ?? 0) - (a.totalLatencyMs ?? 0));
        const top = ranked[0];
        if (top && top.totalLatencyMs !== null) {
            const share = top.totalLatencyMs / totalWallTime;
            if (share >= config.minHotspotShare) {
                out.push({
                    kind: 'hotspot',
                    summary: `${top.method} consumed ${formatMs(top.totalLatencyMs)} of total wall time`,
                    detail: `${Math.round(share * 100)}% of ${formatMs(totalWallTime)} sampled latency`,
                    methods: [top.method],
                });
            }
        }
    }

    // LONG TAIL — methods with disproportionate p99/p50 (sometimes slow).
    const longTailCandidates = perMethod
        .filter(
            (m) =>
                m.sampleSize >= config.minSamplesForTail &&
                m.p50 !== null &&
                m.p99 !== null &&
                m.p50 > 0 &&
                m.p99 / m.p50 >= config.longTailRatio,
        )
        .sort((a, b) => (b.p99 ?? 0) / (b.p50 ?? 1) - (a.p99 ?? 0) / (a.p50 ?? 1));
    const tail = longTailCandidates[0];
    if (tail && tail.p99 !== null && tail.p50 !== null) {
        const ratio = Math.round(tail.p99 / tail.p50);
        out.push({
            kind: 'long-tail',
            summary: `${tail.method} has a long tail — p99 is ${ratio}× the p50`,
            detail: `p50 ${formatMs(tail.p50)} · p99 ${formatMs(tail.p99)} · ${tail.sampleSize} samples`,
            methods: [tail.method],
        });
    }

    // OUTLIER — a single slow call that dominates its method's percentile.
    // Inserted before BUSIEST so the order in the panel is severity-aware:
    // wall-time hotspot → distribution tail → single bad call → volume noise
    // → errors.
    const outlierCandidate = [...perMethod]
        .filter(
            (m) =>
                m.sampleSize >= config.minSamplesForOutlier &&
                m.p99 !== null &&
                m.max !== null &&
                m.p99 > 0 &&
                m.max / m.p99 >= config.outlierRatio,
        )
        .sort((a, b) => (b.max ?? 0) - (a.max ?? 0))[0];
    if (outlierCandidate && outlierCandidate.max !== null && outlierCandidate.p99 !== null) {
        const ratio = Math.round(outlierCandidate.max / outlierCandidate.p99);
        out.push({
            kind: 'outlier',
            summary: `${outlierCandidate.method} had one ${formatMs(outlierCandidate.max)} call — ${ratio}× its p99`,
            detail: `p99 ${formatMs(outlierCandidate.p99)} · ${outlierCandidate.sampleSize} samples`,
            methods: [outlierCandidate.method],
        });
    }

    // BUSIEST — only when a method genuinely dominates traffic. Requires
    // both an absolute count threshold AND a ratio over the next-busiest
    // method, so the typical ACP session/update chunking pattern doesn't
    // produce a noisy insight ("session/update sent 20 notifications").
    const ranked = [...perMethod].sort((a, b) => b.count - a.count);
    const busiest = ranked[0];
    const second = ranked[1];
    if (busiest && busiest.count >= config.minBusiestCount) {
        const ratio = second && second.count > 0 ? busiest.count / second.count : Infinity;
        if (ratio >= config.minBusiestRatio) {
            const noun = busiest.kind === 'notification' ? 'notifications' : 'calls';
            out.push({
                kind: 'busiest',
                summary: `${busiest.method} sent ${busiest.count} ${noun}`,
                detail: second
                    ? `${ratio.toFixed(1)}× the next-busiest method (${second.method} · ${second.count})`
                    : 'no other methods to compare against',
                methods: [busiest.method],
            });
        }
    }

    // ERRORS — methods that produced a kind='error' frame. Walks messages
    // to attribute errors back to their paired request's method (errors
    // themselves don't carry method).
    const errorMethods = collectErrorMethods(messages);
    if (errorMethods.length > 0) {
        const shown = errorMethods.slice(0, 3);
        const more = errorMethods.length > 3 ? ` (+${errorMethods.length - 3} more)` : '';
        out.push({
            kind: 'errors',
            summary: `${errorMethods.length} method${errorMethods.length === 1 ? '' : 's'} returned an error`,
            detail: shown.join(', ') + more,
            methods: errorMethods,
        });
    }

    return out;
}

function collectErrorMethods(messages: CapturedMessage[]): string[] {
    const requestMethods = new Map<string, string>(); // rpcId → method
    const errored = new Set<string>();
    for (const m of messages) {
        const id = m.rpcId === undefined || m.rpcId === null ? null : String(m.rpcId);
        if (m.kind === 'request' && m.method && id !== null) {
            requestMethods.set(id, m.method);
        } else if (m.kind === 'error' && id !== null) {
            const method = requestMethods.get(id);
            if (method) errored.add(method);
        }
    }
    return [...errored].sort();
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m${s}s`;
}

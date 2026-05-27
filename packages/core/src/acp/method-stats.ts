import type { CapturedMessage } from './types.js';

export interface PairInfo {
    pairSeq: number;
    latencyMs: number;
}

/**
 * Build a bidirectional `seq → paired seq + latency` index by walking the
 * messages in arrival order and matching responses/errors to their preceding
 * requests via `rpcId`. Both sides of a pair are written, so `pairs.get(req.seq)`
 * and `pairs.get(resp.seq)` both return the same `latencyMs`.
 *
 * Sole authoritative pair index — CLI (`stats`, `inspect`, `validate`) and
 * UI (`StatsBar`, `DetailPanel`, `PerformancePanel`) all read latencies
 * through this function so percentiles agree to the millisecond.
 */
export function buildPairIndex(messages: CapturedMessage[]): Map<number, PairInfo> {
    const idToReq = new Map<string, CapturedMessage>();
    const out = new Map<number, PairInfo>();
    for (const m of messages) {
        if (m.rpcId === undefined || m.rpcId === null) continue;
        const key = String(m.rpcId);
        if (m.kind === 'request') {
            idToReq.set(key, m);
        } else if (m.kind === 'response' || m.kind === 'error') {
            const req = idToReq.get(key);
            if (!req) continue;
            const latencyMs = Math.max(0, m.timestamp - req.timestamp);
            out.set(req.seq, { pairSeq: m.seq, latencyMs });
            out.set(m.seq, { pairSeq: req.seq, latencyMs });
        }
    }
    return out;
}

export interface MethodStats {
    method: string;
    kind: 'request' | 'notification';
    count: number;
    /** Number of latency samples (only request rows have a paired response). */
    sampleSize: number;
    p50: number | null;
    p99: number | null;
    /** Highest latency observed (ms), or null when no samples. */
    max: number | null;
    /** Sum of all sampled latencies (ms), useful for "wall time per method". */
    totalLatencyMs: number | null;
    /**
     * Raw latency samples for this method, sorted ascending. Empty for
     * notifications. Used by the inspector to render per-row sparkline
     * distributions; the percentile fields above are computed from this same
     * array.
     */
    latencies: number[];
}

/**
 * Per-method counts + latency percentiles. Latency is collected from REQUEST
 * rows (not responses) so the same pair is counted once. Notifications contribute
 * counts only — no latency by definition.
 *
 * Sort order: highest count first; ties broken by request-kind before notification.
 */
export function buildPerMethodStats(messages: CapturedMessage[]): MethodStats[] {
    const pairs = buildPairIndex(messages);
    type Bucket = { count: number; latencies: number[] };
    const reqByMethod = new Map<string, Bucket>();
    const ntfByMethod = new Map<string, Bucket>();

    for (const m of messages) {
        if (!m.method) continue;
        if (m.kind === 'request') {
            let b = reqByMethod.get(m.method);
            if (!b) {
                b = { count: 0, latencies: [] };
                reqByMethod.set(m.method, b);
            }
            b.count += 1;
            const p = pairs.get(m.seq);
            if (p) b.latencies.push(p.latencyMs);
        } else if (m.kind === 'notification') {
            let b = ntfByMethod.get(m.method);
            if (!b) {
                b = { count: 0, latencies: [] };
                ntfByMethod.set(m.method, b);
            }
            b.count += 1;
        }
    }

    const out: MethodStats[] = [];
    for (const [method, bucket] of reqByMethod) {
        bucket.latencies.sort((a, b) => a - b);
        out.push({
            method,
            kind: 'request',
            count: bucket.count,
            sampleSize: bucket.latencies.length,
            p50: bucket.latencies.length ? percentile(bucket.latencies, 50) : null,
            p99: bucket.latencies.length ? percentile(bucket.latencies, 99) : null,
            max: bucket.latencies.length ? bucket.latencies[bucket.latencies.length - 1]! : null,
            totalLatencyMs: bucket.latencies.length
                ? bucket.latencies.reduce((acc, x) => acc + x, 0)
                : null,
            latencies: bucket.latencies,
        });
    }
    for (const [method, bucket] of ntfByMethod) {
        out.push({
            method,
            kind: 'notification',
            count: bucket.count,
            sampleSize: 0,
            p50: null,
            p99: null,
            max: null,
            totalLatencyMs: null,
            latencies: [],
        });
    }
    out.sort((a, b) => b.count - a.count || (a.kind === 'request' ? -1 : 1));
    return out;
}

/**
 * Linear-interpolation percentile. Returns raw float — callers round at the
 * presentation layer if needed. The same algorithm sits in
 * `packages/ui/src/lib/format.ts` (UI StatsBar) — keep them in lock-step so
 * the inspector and `acp-devtools stats` agree to the millisecond.
 */
export function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const rank = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const a = sortedAsc[lo];
    const b = sortedAsc[hi];
    if (a === undefined || b === undefined) return a ?? 0;
    if (lo === hi) return a;
    return a + (b - a) * (rank - lo);
}

export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((acc, x) => acc + x, 0) / values.length;
}

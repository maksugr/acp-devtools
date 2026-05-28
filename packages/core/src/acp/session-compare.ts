import type { CapturedMessage } from './types.js';
import { diffJson, type JsonChange } from './session-diff.js';
import { buildPerMethodStats, type MethodStats } from './method-stats.js';
import { extractSessionMetadata, type SessionMetadata } from './session-metadata.js';

/**
 * Two layers of session comparison that complement the frame-level diff: a
 * **metadata** diff (client/agent identity, capabilities, protocol, runtime)
 * and a **per-method latency** delta. Both are aggregates, so unlike raw frame
 * diffing they don't drown in volatile per-run values (sessionId, proxy_key) —
 * they're the high-signal answer to "how do these two similar sessions differ".
 */

export interface MetadataDiff {
    a: SessionMetadata;
    b: SessionMetadata;
    /** Field-level changes between the comparable metadata of A and B. */
    changes: JsonChange[];
}

/**
 * The stable, high-signal slice of metadata. `extensions` (JetBrains
 * `proxyConfig` carries per-session-rotating `proxy_key`s) is excluded on
 * purpose — it's editor-specific and volatile, exactly the noise this view
 * exists to avoid.
 */
function comparableMetadata(m: SessionMetadata) {
    return {
        protocolVersion: m.protocolVersion,
        client: m.client,
        agent: m.agent,
        clientCapabilities: m.clientCapabilities,
        agentCapabilities: m.agentCapabilities,
        runtime: m.runtime,
    };
}

export function buildMetadataDiff(a: CapturedMessage[], b: CapturedMessage[]): MetadataDiff {
    const am = extractSessionMetadata(a);
    const bm = extractSessionMetadata(b);
    return {
        a: am,
        b: bm,
        changes: diffJson(comparableMetadata(am), comparableMetadata(bm)),
    };
}

export interface MethodStatsDelta {
    method: string;
    kind: 'request' | 'notification';
    /** Stats on the A side, or null when the method only appears in B. */
    a: MethodStats | null;
    /** Stats on the B side, or null when the method only appears in A. */
    b: MethodStats | null;
    countDelta: number;
    /** b − a; null when either side lacks a latency sample. */
    p50Delta: number | null;
    p99Delta: number | null;
    maxDelta: number | null;
}

/**
 * Join per-method stats of two sessions by (method, kind) and compute deltas.
 * Sorted by the largest absolute p99 change first (the biggest latency
 * movement), then by count change — so a regression surfaces at the top.
 */
export function buildMethodStatsDiff(
    a: CapturedMessage[],
    b: CapturedMessage[],
): MethodStatsDelta[] {
    const aStats = buildPerMethodStats(a);
    const bStats = buildPerMethodStats(b);
    const key = (m: MethodStats) => `${m.kind}:${m.method}`;
    const aMap = new Map(aStats.map((m) => [key(m), m]));
    const bMap = new Map(bStats.map((m) => [key(m), m]));

    const out: MethodStatsDelta[] = [];
    for (const k of new Set([...aMap.keys(), ...bMap.keys()])) {
        const am = aMap.get(k) ?? null;
        const bm = bMap.get(k) ?? null;
        const ref = (am ?? bm)!;
        out.push({
            method: ref.method,
            kind: ref.kind,
            a: am,
            b: bm,
            countDelta: (bm?.count ?? 0) - (am?.count ?? 0),
            p50Delta: deltaOf(am?.p50, bm?.p50),
            p99Delta: deltaOf(am?.p99, bm?.p99),
            maxDelta: deltaOf(am?.max, bm?.max),
        });
    }
    out.sort(
        (x, y) =>
            Math.abs(y.p99Delta ?? 0) - Math.abs(x.p99Delta ?? 0) ||
            Math.abs(y.countDelta) - Math.abs(x.countDelta) ||
            x.method.localeCompare(y.method),
    );
    return out;
}

function deltaOf(a: number | null | undefined, b: number | null | undefined): number | null {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return b - a;
}

import type { CapturedMessage } from './types.js';
import { buildPairIndex } from './method-stats.js';

export type LaneId = 'editor-req' | 'agent-req' | 'notification';

export interface LaneEvent {
    /** Original message seq for click-to-jump. */
    seq: number;
    /** Wall-clock start of this event (ms). */
    startTs: number;
    /**
     * Wall-clock end. For requests, the paired response/error timestamp.
     * For notifications and unpaired requests, equals `startTs`.
     */
    endTs: number;
    /** Lane assignment driving y-position in the waterfall. */
    lane: LaneId;
    /** Method name when available; used for tooltip label. */
    method: string | null;
    /** Original message kind — drives the rect's color tone. */
    kind: CapturedMessage['kind'];
    /** True when this request ended in a kind='error' frame. */
    erroredOut: boolean;
    /**
     * Paired counterpart seq (response/error) when this is a request with a
     * resolved pair. `null` for orphan requests and for notifications.
     */
    pairedSeq: number | null;
}

export interface TimelineLayout {
    events: LaneEvent[];
    /** Earliest message timestamp in the session. */
    startTs: number;
    /**
     * Latest end-timestamp — `max(event.endTs)`, which can exceed
     * `max(message.timestamp)` if the helper falls back to a wall-clock
     * "now" for an open-ended request.
     */
    endTs: number;
    /** Total duration in ms (`endTs - startTs`). */
    durationMs: number;
    /** Count by lane — used to size each lane's vertical strip. */
    laneCounts: Record<LaneId, number>;
}

/**
 * Project a session's captured messages onto three horizontal lanes for a
 * waterfall view:
 *
 * - `editor-req`  — requests sent from the editor to the agent
 *                   (most user traffic: initialize, prompt, set_mode, …)
 * - `agent-req`   — the rarer reverse direction (permissions etc)
 * - `notification` — any-direction notifications, including streaming chunks
 *
 * Responses and errors are NOT their own events — they extend the request
 * rect's `endTs` (and flip `erroredOut`). An unpaired request produces a
 * zero-width "tick" at its timestamp.
 *
 * Pure — no DOM, no time, no IO. Used by the canvas TimelineView in the UI;
 * could equally drive an SVG export or a TUI rendering.
 */
export function buildTimelineLayout(messages: CapturedMessage[]): TimelineLayout {
    const empty: TimelineLayout = {
        events: [],
        startTs: 0,
        endTs: 0,
        durationMs: 0,
        laneCounts: { 'editor-req': 0, 'agent-req': 0, notification: 0 },
    };
    if (messages.length === 0) return empty;

    const pairs = buildPairIndex(messages);
    const bySeq = new Map<number, CapturedMessage>();
    for (const m of messages) bySeq.set(m.seq, m);

    let startTs = Infinity;
    let endTs = -Infinity;
    const events: LaneEvent[] = [];
    const laneCounts: Record<LaneId, number> = {
        'editor-req': 0,
        'agent-req': 0,
        notification: 0,
    };

    for (const m of messages) {
        if (m.timestamp < startTs) startTs = m.timestamp;
        if (m.timestamp > endTs) endTs = m.timestamp;

        if (m.kind === 'request') {
            const lane: LaneId = m.direction === 'editor-to-agent' ? 'editor-req' : 'agent-req';
            const pair = pairs.get(m.seq);
            const pairedMsg = pair ? bySeq.get(pair.pairSeq) : undefined;
            const erroredOut = pairedMsg?.kind === 'error';
            const evtEnd = pairedMsg ? pairedMsg.timestamp : m.timestamp;
            if (evtEnd > endTs) endTs = evtEnd;
            events.push({
                seq: m.seq,
                startTs: m.timestamp,
                endTs: evtEnd,
                lane,
                method: m.method ?? null,
                kind: m.kind,
                erroredOut,
                pairedSeq: pairedMsg ? pairedMsg.seq : null,
            });
            laneCounts[lane] += 1;
        } else if (m.kind === 'notification') {
            events.push({
                seq: m.seq,
                startTs: m.timestamp,
                endTs: m.timestamp,
                lane: 'notification',
                method: m.method ?? null,
                kind: m.kind,
                erroredOut: false,
                pairedSeq: null,
            });
            laneCounts.notification += 1;
        }
        // Responses/errors/unknowns contribute to time-range only — they're
        // already represented by their paired request's extended endTs.
    }

    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return empty;
    return {
        events,
        startTs,
        endTs,
        durationMs: Math.max(0, endTs - startTs),
        laneCounts,
    };
}

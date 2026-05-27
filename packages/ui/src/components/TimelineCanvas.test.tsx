import { describe, expect, it } from 'vitest';
import type { LaneEvent } from '@acp-devtools/core/acp/timeline-layout';
import { buildProjection } from './TimelineCanvas';

const ev = (overrides: Partial<LaneEvent> & { seq: number }): LaneEvent => ({
    startTs: 0,
    endTs: 0,
    lane: 'editor-req',
    method: 'session/prompt',
    kind: 'request',
    erroredOut: false,
    pairedSeq: null,
    ...overrides,
});

describe('buildProjection — no gaps', () => {
    it('returns a single active segment when events have no idle gaps', () => {
        const events: LaneEvent[] = [
            ev({ seq: 1, startTs: 0, endTs: 1000 }),
            ev({ seq: 2, startTs: 2000, endTs: 3000 }),
        ];
        const proj = buildProjection(events, 0, 3000, 800, 1, 0);
        expect(proj.segments).toHaveLength(1);
        expect(proj.segments[0]?.kind).toBe('active');
        expect(proj.totalActiveMs).toBe(3000);
    });

    it('places first event at canvas left edge, last at right edge', () => {
        const events: LaneEvent[] = [
            ev({ seq: 1, startTs: 0, endTs: 100 }),
            ev({ seq: 2, startTs: 1000, endTs: 1000 }),
        ];
        const proj = buildProjection(events, 0, 1000, 800, 1, 0);
        // tsToX includes PADDING_LEFT (132) and we passed pan=0.
        const startX = proj.tsToX(0);
        const endX = proj.tsToX(1000);
        expect(startX).toBeGreaterThanOrEqual(132);
        expect(endX).toBeGreaterThan(startX);
    });
});

describe('buildProjection — compressed gaps', () => {
    it('detects an idle gap > 30s and splits into active/gap/active', () => {
        // Two clusters separated by an 80-minute idle period — the scenario
        // from the screenshot ("сломанный таймлайн").
        const events: LaneEvent[] = [
            ev({ seq: 1, startTs: 0, endTs: 1000 }),
            ev({ seq: 2, startTs: 4_800_000, endTs: 4_801_000 }),
        ];
        const proj = buildProjection(events, 0, 4_801_000, 1000, 1, 0);
        const kinds = proj.segments.map((s) => s.kind);
        expect(kinds).toContain('gap');
        const gap = proj.segments.find((s) => s.kind === 'gap');
        expect(gap?.tStart).toBe(1000);
        expect(gap?.tEnd).toBe(4_800_000);
    });

    it('compresses each gap to a fixed pixel width (no proportional stretching)', () => {
        const events: LaneEvent[] = [
            ev({ seq: 1, startTs: 0, endTs: 1000 }),
            ev({ seq: 2, startTs: 4_800_000, endTs: 4_801_000 }),
        ];
        const proj = buildProjection(events, 0, 4_801_000, 800, 1, 0);
        const gap = proj.segments.find((s) => s.kind === 'gap')!;
        // GAP_PX_WIDTH constant — 50px regardless of how long the gap is.
        expect(gap.pxEnd - gap.pxStart).toBe(50);
    });

    it('totalActiveMs is the sum of active windows, not the wall-clock duration', () => {
        const events: LaneEvent[] = [
            ev({ seq: 1, startTs: 0, endTs: 1000 }),
            ev({ seq: 2, startTs: 60_000, endTs: 61_000 }),
        ];
        const proj = buildProjection(events, 0, 61_000, 800, 1, 0);
        // Two 1s active windows = 2000ms total active, despite wall-clock
        // span of 61s (gap is 59s, > 30s threshold).
        expect(proj.totalActiveMs).toBeLessThan(61_000);
    });
});

describe('buildProjection — tsToX', () => {
    it('maps timestamps inside active segments linearly', () => {
        const events: LaneEvent[] = [ev({ seq: 1, startTs: 0, endTs: 1000 })];
        const proj = buildProjection(events, 0, 1000, 800, 1, 0);
        const mid = proj.tsToX(500);
        const start = proj.tsToX(0);
        const end = proj.tsToX(1000);
        // mid should fall roughly halfway between start and end.
        expect(mid).toBeGreaterThan(start);
        expect(mid).toBeLessThan(end);
    });

    it('clamps timestamps before the first segment to the canvas left', () => {
        const events: LaneEvent[] = [ev({ seq: 1, startTs: 100, endTs: 200 })];
        const proj = buildProjection(events, 100, 200, 800, 1, 0);
        const beforeAll = proj.tsToX(-1000);
        const atStart = proj.tsToX(100);
        expect(beforeAll).toBe(atStart);
    });

    it('honours pan offset by subtracting it from the computed x', () => {
        const events: LaneEvent[] = [ev({ seq: 1, startTs: 0, endTs: 1000 })];
        const proj0 = buildProjection(events, 0, 1000, 800, 1, 0);
        const proj100 = buildProjection(events, 0, 1000, 800, 1, 100);
        expect(proj100.tsToX(0)).toBe(proj0.tsToX(0) - 100);
    });
});

describe('buildProjection — empty input', () => {
    it('returns a single passthrough segment for zero events', () => {
        const proj = buildProjection([], 0, 1000, 800, 1, 0);
        expect(proj.segments).toHaveLength(1);
        expect(proj.totalActiveMs).toBe(0);
    });
});

describe('buildProjection — gap markers shift with pan (regression)', () => {
    // Previously drawGapMarkers used `seg.pxStart/pxEnd` directly, which
    // are projection-relative coordinates without the pan offset. Events
    // (which go through `tsToX`) slid with the drag, but the gap marker
    // stayed pinned to the canvas — leaving "idle Xm" labels misaligned
    // relative to surrounding event bars. This test guards the contract
    // that drawGapMarkers should use `tsToX(seg.tStart/tEnd)` so the
    // marker pans with the rest of the timeline.
    const events: LaneEvent[] = [
        ev({ seq: 1, startTs: 0, endTs: 1000 }),
        ev({ seq: 2, startTs: 4_800_000, endTs: 4_801_000 }),
    ];

    it('tsToX on a gap segment endpoint shifts by exactly the pan delta', () => {
        const proj0 = buildProjection(events, 0, 4_801_000, 800, 1, 0);
        const proj200 = buildProjection(events, 0, 4_801_000, 800, 1, 200);
        const gap0 = proj0.segments.find((s) => s.kind === 'gap')!;
        const gap200 = proj200.segments.find((s) => s.kind === 'gap')!;
        expect(proj200.tsToX(gap200.tStart)).toBe(proj0.tsToX(gap0.tStart) - 200);
        expect(proj200.tsToX(gap200.tEnd)).toBe(proj0.tsToX(gap0.tEnd) - 200);
    });

    it('gap visual width stays constant across pans (segment-internal pxStart/pxEnd unaffected)', () => {
        const proj0 = buildProjection(events, 0, 4_801_000, 800, 1, 0);
        const proj500 = buildProjection(events, 0, 4_801_000, 800, 1, 500);
        const gap0 = proj0.segments.find((s) => s.kind === 'gap')!;
        const gap500 = proj500.segments.find((s) => s.kind === 'gap')!;
        // 50px GAP_PX_WIDTH at any pan offset.
        expect(gap0.pxEnd - gap0.pxStart).toBe(gap500.pxEnd - gap500.pxStart);
    });
});

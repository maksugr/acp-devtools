import { useEffect, useMemo, useRef, useState } from 'react';
import type { LaneEvent, LaneId } from '@acp-devtools/core/acp/timeline-layout';
import { buildTimelineLayout } from '@acp-devtools/core/acp/timeline-layout';
import type { CapturedMessage } from '@acp-devtools/core';
import { formatLatency } from '../lib/format';
import { cn } from '../lib/cn';

interface TimelineCanvasProps {
    messages: CapturedMessage[];
    /** Called when the user clicks a rect — typically jumps to that message. */
    onSelectSeq?: (seq: number) => void;
    /** Visual height — caller controls how much vertical space to give. */
    height?: number;
    /**
     * Imperative-control ref. Parent can call `.zoomIn()` / `.zoomOut()` /
     * `.reset()` to wire its own zoom buttons (e.g. inside a section header
     * shared with other panel chrome). When omitted, the canvas falls back
     * to a built-in floating control overlay.
     */
    controlsRef?: React.MutableRefObject<TimelineCanvasControls | null>;
    /** Optional callback for parent to mirror current zoom level. */
    onZoomChange?: (zoom: number) => void;
}

export interface TimelineCanvasControls {
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
    getZoom: () => number;
}

interface RenderEvent extends LaneEvent {
    x: number;
    width: number;
    y: number;
    height: number;
}

const LANE_ORDER: LaneId[] = ['editor-req', 'agent-req', 'notification'];
const LANE_LABEL: Record<LaneId, string> = {
    'editor-req': 'editor → agent',
    'agent-req': 'agent → editor',
    notification: 'notifications',
};

const LANE_HEIGHT = 48;
const LANE_GAP = 6;
const TIME_AXIS_HEIGHT = 24;
const PADDING_LEFT = 132;
const PADDING_RIGHT = 20;
const PADDING_TOP = 8;
const LANE_LABEL_X = 20;
/** Gaps longer than this between events are visually compressed. */
const GAP_THRESHOLD_MS = 30_000;
/** Fixed pixel width of a compressed-gap region. */
const GAP_PX_WIDTH = 50;

export interface Segment {
    kind: 'active' | 'gap';
    tStart: number;
    tEnd: number;
    /** Pixel offset from canvas left edge (excluding PADDING_LEFT and pan). */
    pxStart: number;
    pxEnd: number;
}

export interface Projection {
    segments: Segment[];
    /** Returns canvas x in CSS pixels for a given timestamp; clamps to bounds. */
    tsToX: (ts: number) => number;
    /** Total active wall-time in this projection (sum of active segments). */
    totalActiveMs: number;
}

export function buildProjection(
    events: LaneEvent[],
    layoutStart: number,
    layoutEnd: number,
    usableWidth: number,
    zoom: number,
    pan: number,
): Projection {
    if (events.length === 0 || layoutEnd <= layoutStart) {
        return {
            segments: [
                {
                    kind: 'active',
                    tStart: layoutStart,
                    tEnd: layoutEnd,
                    pxStart: 0,
                    pxEnd: usableWidth * zoom,
                },
            ],
            tsToX: () => PADDING_LEFT - pan,
            totalActiveMs: 0,
        };
    }
    const sorted = [...events].sort((a, b) => a.startTs - b.startTs);
    const rawSegments: Array<{ kind: 'active' | 'gap'; tStart: number; tEnd: number }> = [];
    let activeStart = layoutStart;
    let cursor = layoutStart;
    for (const ev of sorted) {
        if (ev.startTs - cursor > GAP_THRESHOLD_MS) {
            if (cursor > activeStart) {
                rawSegments.push({ kind: 'active', tStart: activeStart, tEnd: cursor });
            }
            rawSegments.push({ kind: 'gap', tStart: cursor, tEnd: ev.startTs });
            activeStart = ev.startTs;
        }
        cursor = Math.max(cursor, ev.endTs);
    }
    if (cursor > activeStart) {
        rawSegments.push({ kind: 'active', tStart: activeStart, tEnd: cursor });
    }
    if (layoutEnd > cursor + GAP_THRESHOLD_MS) {
        rawSegments.push({ kind: 'gap', tStart: cursor, tEnd: layoutEnd });
    } else if (layoutEnd > cursor && rawSegments.length > 0) {
        rawSegments[rawSegments.length - 1]!.tEnd = layoutEnd;
    }

    const gapCount = rawSegments.filter((s) => s.kind === 'gap').length;
    const totalActiveMs = rawSegments
        .filter((s) => s.kind === 'active')
        .reduce((acc, s) => acc + (s.tEnd - s.tStart), 0);
    const fullWidth = usableWidth * zoom;
    const compressedActiveWidth = Math.max(50, fullWidth - gapCount * GAP_PX_WIDTH);
    const pxPerActiveMs = totalActiveMs > 0 ? compressedActiveWidth / totalActiveMs : 0;

    let pxCursor = 0;
    const segments: Segment[] = [];
    for (const seg of rawSegments) {
        const width =
            seg.kind === 'gap'
                ? GAP_PX_WIDTH
                : (seg.tEnd - seg.tStart) * pxPerActiveMs;
        segments.push({
            ...seg,
            pxStart: pxCursor,
            pxEnd: pxCursor + width,
        });
        pxCursor += width;
    }

    const tsToX = (ts: number): number => {
        if (ts <= segments[0]!.tStart) {
            return PADDING_LEFT + segments[0]!.pxStart - pan;
        }
        for (const seg of segments) {
            if (ts >= seg.tStart && ts <= seg.tEnd) {
                const within = seg.tEnd > seg.tStart
                    ? (ts - seg.tStart) / (seg.tEnd - seg.tStart)
                    : 0;
                const localPx = seg.pxStart + within * (seg.pxEnd - seg.pxStart);
                return PADDING_LEFT + localPx - pan;
            }
        }
        const last = segments[segments.length - 1]!;
        return PADDING_LEFT + last.pxEnd - pan;
    };

    return { segments, tsToX, totalActiveMs };
}

/**
 * Embeddable canvas waterfall. Owns its own zoom/pan/hover state but no
 * surrounding chrome — caller wraps it in whatever layout it needs (a
 * full-screen overlay, or a section at the bottom of a wider panel).
 */
export function TimelineCanvas({
    messages,
    onSelectSeq,
    height = 220,
    controlsRef,
    onZoomChange,
}: TimelineCanvasProps) {
    const layout = useMemo(() => buildTimelineLayout(messages), [messages]);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [size, setSize] = useState({ width: 800, height });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState(0);
    const [hovered, setHovered] = useState<RenderEvent | null>(null);
    const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const dragRef = useRef<{ startX: number; startPan: number } | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const rect = entry.contentRect;
            setSize({ width: Math.max(320, rect.width), height: Math.max(120, rect.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        setZoom(1);
        setPan(0);
        setHovered(null);
    }, [layout.startTs, layout.endTs]);

    const projection = useMemo<Projection>(() => {
        const usableWidth = Math.max(50, size.width - PADDING_LEFT - PADDING_RIGHT);
        return buildProjection(
            layout.events,
            layout.startTs,
            layout.endTs,
            usableWidth,
            zoom,
            pan,
        );
    }, [layout, size.width, zoom, pan]);

    const renderEvents = useMemo<RenderEvent[]>(() => {
        if (layout.events.length === 0) return [];
        const out: RenderEvent[] = [];
        for (const ev of layout.events) {
            const x = projection.tsToX(ev.startTs);
            const xEnd = projection.tsToX(ev.endTs);
            const width = Math.max(2, xEnd - x);
            const laneIdx = LANE_ORDER.indexOf(ev.lane);
            const y =
                PADDING_TOP +
                TIME_AXIS_HEIGHT +
                laneIdx * (LANE_HEIGHT + LANE_GAP) +
                LANE_HEIGHT / 2 -
                9;
            out.push({ ...ev, x, y, width, height: 18 });
        }
        return out;
    }, [layout, projection]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size.width * dpr;
        canvas.height = size.height * dpr;
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cs = getComputedStyle(document.documentElement);
        const color = (token: string) => `rgb(${cs.getPropertyValue(`--${token}`).trim()})`;
        const colorAlpha = (token: string, a: number) =>
            `rgba(${cs.getPropertyValue(`--${token}`).trim()} / ${a})`;
        ctx.clearRect(0, 0, size.width, size.height);
        drawLanes(ctx, size, color);
        drawGapMarkers(ctx, projection, size, color, colorAlpha);
        drawTimeAxis(ctx, size, projection, color);
        drawEvents(ctx, renderEvents, hovered, color, colorAlpha);
    }, [renderEvents, projection, size, hovered]);

    const hitTest = (mx: number, my: number): RenderEvent | null => {
        for (const ev of renderEvents) {
            const w = Math.max(ev.width, 6);
            if (mx >= ev.x && mx <= ev.x + w && my >= ev.y && my <= ev.y + ev.height) {
                return ev;
            }
        }
        return null;
    };

    const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (dragRef.current) {
            const delta = mx - dragRef.current.startX;
            setPan(Math.max(0, dragRef.current.startPan - delta));
            return;
        }
        const ev = hitTest(mx, my);
        setHovered(ev);
        setHoverPos({ x: e.clientX, y: e.clientY });
    };

    const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ev = hitTest(mx, my);
        if (ev && onSelectSeq) {
            onSelectSeq(ev.seq);
            return;
        }
        dragRef.current = { startX: mx, startPan: pan };
    };

    const onMouseUp = () => {
        dragRef.current = null;
    };

    const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        if (!e.metaKey && !e.ctrlKey) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setZoom((z) => Math.min(50, Math.max(0.3, z * factor)));
    };

    const zoomIn = () => setZoom((z) => Math.min(50, z * 1.5));
    const zoomOut = () => setZoom((z) => Math.max(0.3, z / 1.5));
    const zoomReset = () => {
        setZoom(1);
        setPan(0);
    };

    // Expose controls + notify parent of zoom changes. Lets the
    // PerformancePanel render zoom buttons in its own section header rather
    // than as a floating overlay on top of the canvas.
    useEffect(() => {
        if (!controlsRef) return;
        controlsRef.current = {
            zoomIn,
            zoomOut,
            reset: zoomReset,
            getZoom: () => zoom,
        };
        return () => {
            if (controlsRef.current) controlsRef.current = null;
        };
    });
    useEffect(() => {
        onZoomChange?.(zoom);
    }, [zoom, onZoomChange]);

    if (layout.events.length === 0) {
        return (
            <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                no messages — capture or load a session first
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative h-full w-full" style={{ minHeight: 0 }}>
            <canvas
                ref={canvasRef}
                className={cn(
                    'block h-full w-full',
                    dragRef.current ? 'cursor-grabbing' : hovered ? 'cursor-pointer' : 'cursor-grab',
                )}
                onMouseMove={onMouseMove}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
                onMouseLeave={() => {
                    setHovered(null);
                    dragRef.current = null;
                }}
                onWheel={onWheel}
            />
            {hovered && (
                <div
                    role="tooltip"
                    className="pointer-events-none fixed z-[150] rounded-sm border border-line bg-surface-base px-3 py-2 font-mono text-[11px] shadow-lg"
                    style={{
                        left: Math.min(window.innerWidth - 280, hoverPos.x + 12),
                        top: hoverPos.y + 12,
                        maxWidth: 280,
                    }}
                >
                    <div className="text-ink-primary">
                        <span className="text-ink-muted">seq {hovered.seq}</span>
                        {' · '}
                        {hovered.method ?? hovered.kind}
                    </div>
                    <div className="text-ink-muted">
                        {hovered.endTs > hovered.startTs
                            ? `${formatLatency(hovered.endTs - hovered.startTs)}${hovered.erroredOut ? ' · error' : ''}`
                            : hovered.lane === 'notification'
                              ? 'notification'
                              : 'pending'}
                    </div>
                    {onSelectSeq && (
                        <div className="mt-1 text-[10px] text-ink-dim">click to inspect</div>
                    )}
                </div>
            )}
        </div>
    );
}

function drawLanes(
    ctx: CanvasRenderingContext2D,
    size: { width: number; height: number },
    color: (t: string) => string,
) {
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'start';
    for (let i = 0; i < LANE_ORDER.length; i++) {
        const lane = LANE_ORDER[i]!;
        const y = PADDING_TOP + TIME_AXIS_HEIGHT + i * (LANE_HEIGHT + LANE_GAP);
        ctx.fillStyle = color('surface-elev');
        ctx.fillRect(PADDING_LEFT, y, size.width - PADDING_LEFT - PADDING_RIGHT, LANE_HEIGHT);
        ctx.fillStyle = color('ink-muted');
        ctx.fillText(LANE_LABEL[lane], LANE_LABEL_X, y + LANE_HEIGHT / 2);
        ctx.strokeStyle = color('line');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, y + LANE_HEIGHT);
        ctx.lineTo(size.width - PADDING_RIGHT, y + LANE_HEIGHT);
        ctx.stroke();
    }
}

function drawTimeAxis(
    ctx: CanvasRenderingContext2D,
    size: { width: number; height: number },
    projection: Projection,
    color: (t: string) => string,
) {
    const baseY = PADDING_TOP + TIME_AXIS_HEIGHT - 4;
    ctx.strokeStyle = color('line');
    ctx.fillStyle = color('ink-muted');
    ctx.font = '10px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1;

    // Pick a tick interval relative to active wall-clock time within
    // visible active segments. We pick step size from the largest active
    // segment so labels remain meaningful (8s, 30s, 1m, etc).
    const longestActive = projection.segments
        .filter((s) => s.kind === 'active')
        .reduce((acc, s) => Math.max(acc, s.tEnd - s.tStart), 0);
    const usable = projection.segments.reduce(
        (acc, s) => acc + (s.kind === 'active' ? s.pxEnd - s.pxStart : 0),
        0,
    );
    const pxPerActiveMs = longestActive > 0 ? usable / projection.totalActiveMs : 0;
    const pxPerSec = pxPerActiveMs * 1000;
    const niceSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    const targetPx = 80;
    let stepSec = niceSteps[niceSteps.length - 1]!;
    for (const s of niceSteps) {
        if (s * pxPerSec >= targetPx) {
            stepSec = s;
            break;
        }
    }
    const stepMs = stepSec * 1000;

    // Draw ticks within each active segment using session-relative time.
    const sessionStart = projection.segments[0]?.tStart ?? 0;
    for (const seg of projection.segments) {
        if (seg.kind !== 'active') continue;
        const firstTick =
            Math.ceil((seg.tStart - sessionStart) / stepMs) * stepMs + sessionStart;
        for (let t = firstTick; t <= seg.tEnd; t += stepMs) {
            const x = projection.tsToX(t);
            if (x < PADDING_LEFT || x > size.width - PADDING_RIGHT) continue;
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY + 4);
            ctx.stroke();
            ctx.fillText(formatTickSeconds(t - sessionStart), x, baseY - 2);
        }
    }
}

function drawGapMarkers(
    ctx: CanvasRenderingContext2D,
    projection: Projection,
    size: { width: number; height: number },
    color: (t: string) => string,
    colorAlpha: (t: string, a: number) => string,
) {
    const laneTop = PADDING_TOP + TIME_AXIS_HEIGHT;
    const laneBottom = laneTop + LANE_ORDER.length * (LANE_HEIGHT + LANE_GAP);
    for (const seg of projection.segments) {
        if (seg.kind !== 'gap') continue;
        // Go through tsToX so the gap marker pans together with events —
        // seg.pxStart/pxEnd are projection-relative (no pan applied), and
        // using them directly leaves the marker "pinned" while events
        // slide underneath it during drag-pan.
        const x = projection.tsToX(seg.tStart);
        const xEnd = projection.tsToX(seg.tEnd);
        const width = xEnd - x;
        if (x > size.width - PADDING_RIGHT || x + width < PADDING_LEFT) continue;

        // Dim background stripe spanning all lanes.
        ctx.fillStyle = colorAlpha('ink-muted', 0.06);
        ctx.fillRect(x, laneTop, width, laneBottom - laneTop);

        // Dashed vertical separators at both ends of the gap.
        ctx.strokeStyle = color('line');
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, laneTop);
        ctx.lineTo(x + 0.5, laneBottom);
        ctx.moveTo(x + width - 0.5, laneTop);
        ctx.lineTo(x + width - 0.5, laneBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // "X min idle" label centred in the gap.
        ctx.fillStyle = color('ink-muted');
        ctx.font = '10px monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const cx = x + width / 2;
        const cy = laneTop + (laneBottom - laneTop) / 2;
        ctx.fillText(formatIdleGap(seg.tEnd - seg.tStart), cx, cy);
    }
}

function formatIdleGap(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s idle`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m idle`;
    const h = Math.floor(ms / 3600_000);
    const m = Math.round((ms % 3600_000) / 60_000);
    return m > 0 ? `${h}h${m}m idle` : `${h}h idle`;
}

function formatTickSeconds(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m${s}s`;
}

function drawEvents(
    ctx: CanvasRenderingContext2D,
    events: RenderEvent[],
    hovered: RenderEvent | null,
    color: (t: string) => string,
    colorAlpha: (t: string, a: number) => string,
) {
    for (const ev of events) {
        const isHovered = hovered?.seq === ev.seq;
        const fill = ev.erroredOut
            ? colorAlpha('accent-error', 0.6)
            : ev.kind === 'notification'
              ? colorAlpha('accent-note', 0.7)
              : ev.lane === 'editor-req'
                ? colorAlpha('accent-out', 0.7)
                : colorAlpha('accent-in', 0.7);
        ctx.fillStyle = isHovered ? fill.replace(/0\.\d+/, '0.95') : fill;
        ctx.fillRect(ev.x, ev.y, Math.max(ev.width, 2), ev.height);
        if (isHovered) {
            ctx.strokeStyle = color('ink-primary');
            ctx.lineWidth = 1;
            ctx.strokeRect(ev.x - 0.5, ev.y - 0.5, Math.max(ev.width, 2) + 1, ev.height + 1);
        }
    }
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    buildPerMethodStats,
    type MethodStats,
} from '@acp-devtools/core/acp/method-stats';
import {
    buildPerformanceInsights,
    type InsightKind,
    type PerformanceInsight,
} from '@acp-devtools/core/acp/perf-insights';
import { extractSessionMetadata } from '@acp-devtools/core/acp/session-metadata';
import { useMessagesStore } from '../store/messagesStore';
import { formatLatency } from '../lib/format';
import { useDrawerAnimation } from '../lib/useDrawerAnimation';
import { cn } from '../lib/cn';
import { Sparkline } from './Sparkline';
import { sessionHeader } from '../lib/captureLabel';
import { TimelineCanvas, type TimelineCanvasControls } from './TimelineCanvas';

type SortKey = 'method' | 'count' | 'p50' | 'p99' | 'max' | 'total';
type SortDir = 'asc' | 'desc';

interface PerformancePanelProps {
    open: boolean;
    onClose: () => void;
    /**
     * Click on a timeline rect inside the drawer. Distinct from `onClose`
     * so the App can push a new history entry (Forward navigation) instead
     * of going Back — keeps the perf-open entry on the stack so the user
     * can `←` to return to it.
     */
    onNavigateToSeq?: (seq: number) => void;
}

export function PerformancePanel({ open, onClose, onNavigateToSeq }: PerformancePanelProps) {
    const messages = useMessagesStore((s) => s.messages);
    const session = useMessagesStore((s) => s.session);
    const select = useMessagesStore((s) => s.select);
    const timelineControlsRef = useRef<TimelineCanvasControls | null>(null);
    const [timelineZoom, setTimelineZoom] = useState(1);
    const perMethod = useMemo<MethodStats[]>(() => buildPerMethodStats(messages), [messages]);
    const insights = useMemo<PerformanceInsight[]>(
        () => buildPerformanceInsights(messages, perMethod),
        [messages, perMethod],
    );
    const maxCount = useMemo(
        () => perMethod.reduce((acc, m) => Math.max(acc, m.count), 0),
        [perMethod],
    );
    const [sortKey, setSortKey] = useState<SortKey>('count');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const { rendered, visible } = useDrawerAnimation(open);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, onClose]);

    const sorted = useMemo<MethodStats[]>(
        () => sortPerMethod(perMethod, sortKey, sortDir),
        [perMethod, sortKey, sortDir],
    );

    const totals = useMemo(() => summarize(perMethod), [perMethod]);

    if (!rendered) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Performance dashboard"
            className={cn(
                'fixed inset-0 z-[100] flex flex-col bg-surface-base/95 backdrop-blur-sm transition-opacity duration-200 ease-out',
                visible ? 'opacity-100' : 'opacity-0',
            )}
        >
            <div
                className={cn(
                    'flex h-full w-full flex-col transition-transform duration-200 ease-out',
                    visible ? 'translate-y-0' : '-translate-y-2',
                )}
            >
                <header className="flex items-center justify-between border-b border-line px-5 py-3">
                    <div className="flex min-w-0 items-baseline gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                            Performance — per-method latency
                        </span>
                        {session && (
                            <span className="truncate font-mono text-[11px] text-ink-secondary">
                                {(() => {
                                    const base = sessionHeader(session);
                                    // The session WS event fires before the
                                    // proxy has seen `initialize`, so for
                                    // freshly-opened live captures
                                    // session.clientName is null. Fall back
                                    // to extracting it from the messages
                                    // themselves — same path the side panel
                                    // uses — so the perf header doesn't show
                                    // just "Claude Code" when the picker
                                    // shows "WebStorm 2026.1.2 · Claude Code".
                                    let secondary = base.secondary;
                                    if (!session.clientName) {
                                        const meta = extractSessionMetadata(messages);
                                        const derivedClient =
                                            meta.client.title ?? meta.client.name ?? null;
                                        if (derivedClient) {
                                            const agentPart = base.secondary;
                                            secondary = agentPart
                                                ? `${derivedClient} · ${agentPart}`
                                                : derivedClient;
                                        }
                                    }
                                    return secondary
                                        ? `${base.primary} · ${secondary}`
                                        : base.primary;
                                })()}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:text-ink-primary"
                        aria-label="Close performance panel"
                    >
                        close
                    </button>
                </header>

                {insights.length > 0 && <InsightsBlock insights={insights} />}

                <div className="border-b border-line bg-surface-elev px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                    {perMethod.length === 0 ? (
                        <span>no messages — capture or load a session first</span>
                    ) : (
                        <span>
                            {totals.methods} methods · {totals.requests} requests ·{' '}
                            {totals.notifications} notifications · {totals.samples} latency samples
                        </span>
                    )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1 overflow-y-auto">
                        {sorted.length === 0 ? null : (
                            <table className="w-full table-fixed text-[11px]">
                                <colgroup>
                                    <col />
                                    <col className="w-[64px]" />
                                    <col className="w-[88px]" />
                                    <col className="w-[80px]" />
                                    <col className="w-[80px]" />
                                    <col className="w-[80px]" />
                                    <col className="w-[80px]" />
                                    <col className="w-[120px]" />
                                </colgroup>
                                <thead className="sticky top-0 z-10 bg-surface-base">
                                    <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                                        <Th sk="method" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} className="!pl-5">
                                            method
                                        </Th>
                                        <th className="px-3 py-2">kind</th>
                                        <Th sk="count" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} align="right">
                                            count
                                        </Th>
                                        <Th sk="p50" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} align="right">
                                            p50
                                        </Th>
                                        <Th sk="p99" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} align="right">
                                            p99
                                        </Th>
                                        <Th sk="max" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} align="right">
                                            max
                                        </Th>
                                        <Th sk="total" current={sortKey} dir={sortDir} onSort={setSort(setSortKey, setSortDir, sortDir)} align="right">
                                            total
                                        </Th>
                                        <th className="py-2 pl-3 pr-5 text-right">dist</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono">
                                    {sorted.map((row) => (
                                        <tr
                                            key={`${row.kind}:${row.method}`}
                                            className="border-b border-line/40 transition-colors hover:bg-surface-rowHover/50"
                                        >
                                            <td className="truncate py-1.5 pl-5 pr-3 text-ink-primary" title={row.method}>
                                                {row.method}
                                            </td>
                                            <td className="px-3 py-1.5 text-ink-muted">
                                                <KindBadge kind={row.kind} />
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-ink-primary">
                                                <CountCell count={row.count} max={maxCount} kind={row.kind} />
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                                {row.p50 !== null ? formatLatency(row.p50) : '—'}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                                {row.p99 !== null ? formatLatency(row.p99) : '—'}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                                {row.max !== null ? formatLatency(row.max) : '—'}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                                {row.totalLatencyMs !== null ? formatLatency(row.totalLatencyMs) : '—'}
                                            </td>
                                            <td className="py-1.5 pl-3 pr-5 text-right">
                                                {row.latencies.length > 0 ? (
                                                    <Sparkline
                                                        values={row.latencies}
                                                        width={88}
                                                        height={14}
                                                        className="text-accent-info"
                                                        title={`${row.method} latency distribution`}
                                                    />
                                                ) : (
                                                    <span className="text-ink-dim">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {messages.length > 0 && (
                        <div className="flex h-[260px] shrink-0 flex-col border-t border-line bg-surface-elev">
                            <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-base px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                                <div className="flex min-w-0 items-baseline gap-2 truncate">
                                    <span>timeline — wall-clock waterfall</span>
                                    <span className="text-ink-dim">
                                        · drag to pan · Cmd/Ctrl + wheel zoom · click to inspect
                                    </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <span className="text-ink-secondary">
                                        {timelineZoom.toFixed(timelineZoom < 1 ? 2 : 1)}×
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => timelineControlsRef.current?.zoomOut()}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-line hover:bg-surface-rowHover hover:text-ink-primary"
                                        aria-label="Zoom out"
                                        title="Zoom out"
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => timelineControlsRef.current?.zoomIn()}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-line hover:bg-surface-rowHover hover:text-ink-primary"
                                        aria-label="Zoom in"
                                        title="Zoom in"
                                    >
                                        +
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => timelineControlsRef.current?.reset()}
                                        className="inline-flex h-5 items-center justify-center rounded-sm border border-line px-2 hover:bg-surface-rowHover hover:text-ink-primary"
                                        aria-label="Reset zoom and pan"
                                        title="Reset zoom and pan to defaults"
                                    >
                                        reset
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1">
                                <TimelineCanvas
                                    messages={messages}
                                    controlsRef={timelineControlsRef}
                                    onZoomChange={setTimelineZoom}
                                    onSelectSeq={(seq) => {
                                        if (onNavigateToSeq) {
                                            onNavigateToSeq(seq);
                                        } else {
                                            select(seq);
                                            onClose();
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const INSIGHT_GLYPH: Record<InsightKind, string> = {
    hotspot: '●',
    'long-tail': '▲',
    outlier: '◆',
    busiest: '■',
    errors: '✗',
};

const INSIGHT_GLYPH_TONE: Record<InsightKind, string> = {
    hotspot: 'text-accent-warn',
    'long-tail': 'text-accent-warn',
    outlier: 'text-accent-warn',
    busiest: 'text-accent-info',
    errors: 'text-accent-error',
};

const INSIGHT_LABEL: Record<InsightKind, string> = {
    hotspot: 'hotspot',
    'long-tail': 'long tail',
    outlier: 'outlier',
    busiest: 'busiest',
    errors: 'errors',
};

function InsightsBlock({ insights }: { insights: PerformanceInsight[] }) {
    return (
        <div className="border-b border-line bg-surface-base px-5 py-2.5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                insights
            </div>
            <ul className="space-y-1.5">
                {insights.map((ins) => (
                    <li key={ins.kind} className="flex items-start gap-2">
                        <span
                            aria-hidden
                            className={cn(
                                'mt-[3px] inline-block text-[9px] leading-none',
                                INSIGHT_GLYPH_TONE[ins.kind],
                            )}
                        >
                            {INSIGHT_GLYPH[ins.kind]}
                        </span>
                        <div className="min-w-[68px] font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                            {INSIGHT_LABEL[ins.kind]}
                        </div>
                        <div className="flex-1 text-[11px] leading-snug">
                            <div className="text-ink-primary">{ins.summary}</div>
                            {ins.detail && (
                                <div className="text-[10px] text-ink-muted">{ins.detail}</div>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function CountCell({
    count,
    max,
    kind,
}: {
    count: number;
    max: number;
    kind: MethodStats['kind'];
}) {
    const pct = max > 0 ? (count / max) * 100 : 0;
    const tone = kind === 'request' ? 'bg-accent-out/15' : 'bg-accent-note/15';
    return (
        <div className="relative inline-block w-[44px] text-right">
            <div
                aria-hidden
                className={cn('absolute inset-y-[1px] right-0 rounded-sm', tone)}
                style={{ width: `${pct}%` }}
            />
            <span className="relative">{count}</span>
        </div>
    );
}

function setSort(
    setKey: (k: SortKey) => void,
    setDir: (d: SortDir) => void,
    currentDir: SortDir,
) {
    return (k: SortKey, isCurrent: boolean) => {
        if (isCurrent) {
            setDir(currentDir === 'asc' ? 'desc' : 'asc');
        } else {
            setKey(k);
            // First-click defaults: counts/latencies → desc (most expensive first),
            // method name → asc (alphabetical).
            setDir(k === 'method' ? 'asc' : 'desc');
        }
    };
}

function Th({
    sk,
    current,
    dir,
    onSort,
    align = 'left',
    className,
    children,
}: {
    sk: SortKey;
    current: SortKey;
    dir: SortDir;
    onSort: (k: SortKey, isCurrent: boolean) => void;
    align?: 'left' | 'right';
    className?: string;
    children: React.ReactNode;
}) {
    const isCurrent = current === sk;
    return (
        <th
            className={cn(
                'cursor-pointer select-none px-3 py-2 transition-colors hover:text-ink-primary',
                align === 'right' ? 'text-right' : '',
                isCurrent ? 'text-ink-primary' : '',
                className,
            )}
            onClick={() => onSort(sk, isCurrent)}
            aria-sort={isCurrent ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <span>{children}</span>
            {isCurrent && <span className="ml-1 text-accent-warn">{dir === 'asc' ? '↑' : '↓'}</span>}
        </th>
    );
}

function KindBadge({ kind }: { kind: MethodStats['kind'] }) {
    const tone = kind === 'request' ? 'text-accent-out' : 'text-accent-note';
    const short = kind === 'request' ? 'req' : 'ntf';
    return (
        <span className={cn('text-[10px] uppercase tracking-widest', tone)} title={kind}>
            {short}
        </span>
    );
}

function summarize(rows: MethodStats[]): {
    methods: number;
    requests: number;
    notifications: number;
    samples: number;
} {
    let requests = 0;
    let notifications = 0;
    let samples = 0;
    for (const r of rows) {
        if (r.kind === 'request') requests += r.count;
        else notifications += r.count;
        samples += r.sampleSize;
    }
    return { methods: rows.length, requests, notifications, samples };
}

export function sortPerMethod(
    rows: MethodStats[],
    key: SortKey,
    dir: SortDir,
): MethodStats[] {
    const mul = dir === 'asc' ? 1 : -1;
    const out = [...rows];
    out.sort((a, b) => {
        const av = numericKey(a, key);
        const bv = numericKey(b, key);
        // null values always sort to the bottom regardless of direction.
        if (av === null && bv !== null) return 1;
        if (av !== null && bv === null) return -1;
        if (key === 'method') return mul * a.method.localeCompare(b.method);
        if (av === null || bv === null) return 0;
        return mul * (av - bv);
    });
    return out;
}

function numericKey(row: MethodStats, key: SortKey): number | null {
    switch (key) {
        case 'method':
            return 0;
        case 'count':
            return row.count;
        case 'p50':
            return row.p50;
        case 'p99':
            return row.p99;
        case 'max':
            return row.max;
        case 'total':
            return row.totalLatencyMs;
    }
}

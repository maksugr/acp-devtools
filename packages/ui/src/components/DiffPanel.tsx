import { useEffect, useMemo, useRef, useState } from 'react';
import {
    buildSessionDiff,
    type DiffRow,
    type JsonChange,
    type SessionDiff,
} from '@acp-devtools/core/acp/session-diff';
import {
    buildMetadataDiff,
    buildMethodStatsDiff,
    type MetadataDiff,
    type MethodStatsDelta,
} from '@acp-devtools/core/acp/session-compare';
import type { CapturedMessage } from '@acp-devtools/core';
import { useMessagesStore } from '../store/messagesStore';
import { fetchSessionMessages, type SavedSession } from '../api/sessions';
import { useDiscoveryStore } from '../store/discoveryStore';
import { useDrawerAnimation } from '../lib/useDrawerAnimation';
import { shortAgentName } from '../lib/captureLabel';
import { formatAge, formatLatency } from '../lib/format';
import { cn } from '../lib/cn';

type DiffTab = 'frames' | 'info' | 'perf';

// One shared top-bar style so the Frames / Info / Perf tabs line up exactly —
// same border, background, padding, and a fixed height so switching tabs never
// shifts the layout.
const TAB_BAR = 'flex h-9 items-center gap-4 border-b border-line bg-surface-base px-5';

interface DiffPanelProps {
    open: boolean;
    onClose: () => void;
}

const KIND_LABEL: Record<CapturedMessage['kind'], string> = {
    request: 'REQ',
    response: 'RSP',
    notification: 'NTF',
    error: 'ERR',
    unknown: 'UNK',
};

function dirArrow(m: CapturedMessage): string {
    return m.direction === 'editor-to-agent' ? '→A' : 'A←';
}

function savedLabel(s: SavedSession): string {
    if (s.name) return `#${s.id} · ${s.name}`;
    const agent = s.agent_command ? shortAgentName(s.agent_command) : 'agent';
    return s.client_name ? `#${s.id} · ${s.client_name} · ${agent}` : `#${s.id} · ${agent}`;
}

interface FrameState {
    messages: CapturedMessage[] | null;
    loading: boolean;
    error: string | null;
}

const IDLE: FrameState = { messages: null, loading: false, error: null };

/**
 * Fetch the full frame list for a saved session by id. Pass null to fetch
 * nothing (used for the side that points at the already-in-memory active
 * session, so we skip a redundant round-trip).
 */
function useFetchedFrames(id: number | null): FrameState {
    const [state, setState] = useState<FrameState>(IDLE);
    useEffect(() => {
        if (id === null) {
            setState(IDLE);
            return;
        }
        let cancelled = false;
        setState({ messages: null, loading: true, error: null });
        fetchSessionMessages(id)
            .then((res) => {
                if (!cancelled) setState({ messages: res.messages, loading: false, error: null });
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setState({
                        messages: null,
                        loading: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [id]);
    return state;
}

export function DiffPanel({ open, onClose }: DiffPanelProps) {
    const storeMessages = useMessagesStore((s) => s.messages);
    const sessionA = useMessagesStore((s) => s.session);
    // Same source the TopBar picker reads — the discovery poller keeps it fresh.
    const savedSessions = useDiscoveryStore((s) => s.savedSessions);
    const activeId = sessionA?.id ?? null;

    const [aId, setAId] = useState<number | null>(null);
    const [bId, setBId] = useState<number | null>(null);
    const [tab, setTab] = useState<DiffTab>('frames');
    const [hideEqual, setHideEqual] = useState(true);
    const [expanded, setExpanded] = useState<number | null>(null);

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

    // Each open re-anchors A to the session the diff was launched from and
    // clears B for a fresh pick — "opened from a concrete session" semantics.
    useEffect(() => {
        if (open) {
            setAId(activeId);
            setBId(null);
            setExpanded(null);
        }
    }, [open, activeId]);

    useEffect(() => setExpanded(null), [aId, bId]);

    // The active session is already in memory; only fetch the side(s) that
    // point elsewhere.
    const aFetched = useFetchedFrames(aId !== null && aId !== activeId ? aId : null);
    const bFetched = useFetchedFrames(bId !== null && bId !== activeId ? bId : null);
    const aMessages = aId === null ? null : aId === activeId ? storeMessages : aFetched.messages;
    const bMessages = bId === null ? null : bId === activeId ? storeMessages : bFetched.messages;
    const loading = aFetched.loading || bFetched.loading;
    const error = aFetched.error ?? bFetched.error;

    const diff = useMemo<SessionDiff | null>(() => {
        if (aMessages === null || bMessages === null) return null;
        return buildSessionDiff(aMessages, bMessages);
    }, [aMessages, bMessages]);

    const visibleRows = useMemo<Array<{ row: DiffRow; index: number }>>(() => {
        if (!diff) return [];
        const out: Array<{ row: DiffRow; index: number }> = [];
        diff.rows.forEach((row, index) => {
            if (hideEqual && row.op === 'equal') return;
            out.push({ row, index });
        });
        return out;
    }, [diff, hideEqual]);

    const bLabel = useMemo(() => {
        const s = savedSessions.find((x) => x.id === bId);
        return s ? savedLabel(s) : null;
    }, [savedSessions, bId]);

    const metaDiff = useMemo<MetadataDiff | null>(
        () => (aMessages && bMessages ? buildMetadataDiff(aMessages, bMessages) : null),
        [aMessages, bMessages],
    );
    const perfDiff = useMemo<MethodStatsDelta[] | null>(
        () => (aMessages && bMessages ? buildMethodStatsDiff(aMessages, bMessages) : null),
        [aMessages, bMessages],
    );

    if (!rendered) return null;

    // A session can't be compared against itself: each side hides the other's pick.
    const aSessions = savedSessions.filter((s) => s.id !== bId);
    const bSessions = savedSessions.filter((s) => s.id !== aId);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Session diff"
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
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                        Diff — compare two sessions
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:text-ink-primary"
                        aria-label="Close diff panel"
                    >
                        close
                    </button>
                </header>

                <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-elev px-5 py-2.5">
                    <span className="font-mono text-[11px] text-accent-out" title="baseline (left)">
                        A
                    </span>
                    <SessionDropdown
                        ariaLabel="Baseline session"
                        sessions={aSessions}
                        selectedId={aId}
                        onSelect={setAId}
                    />
                    <span className="text-ink-muted">→</span>
                    <span className="font-mono text-[11px] text-ink-secondary" title="comparison (right)">
                        B
                    </span>
                    <SessionDropdown
                        ariaLabel="Comparison session"
                        sessions={bSessions}
                        selectedId={bId}
                        onSelect={setBId}
                    />
                </div>

                {(() => {
                    if (aId === null)
                        return <Filler>Pick a baseline session (A) to compare from.</Filler>;
                    if (bId === null)
                        return (
                            <Filler>Pick a session in the B selector above to compare against A.</Filler>
                        );
                    if (loading) return <Filler>Loading sessions…</Filler>;
                    if (error)
                        return <Filler tone="error">Could not load a session: {error}</Filler>;
                    if (!diff || !metaDiff || !perfDiff) return <Filler>No data.</Filler>;
                    return (
                        <>
                            <DiffTabs
                                tab={tab}
                                onTab={setTab}
                                summary={diff.summary}
                                infoCount={metaDiff.changes.length}
                            />
                            <div className="min-h-0 flex-1 overflow-y-auto">
                                {tab === 'frames' && (
                                    <FramesView
                                        diff={diff}
                                        bLabel={bLabel}
                                        hideEqual={hideEqual}
                                        onHideEqual={setHideEqual}
                                        visibleRows={visibleRows}
                                        expanded={expanded}
                                        onToggleExpand={(i) =>
                                            setExpanded((cur) => (cur === i ? null : i))
                                        }
                                    />
                                )}
                                {tab === 'info' && <InfoView meta={metaDiff} />}
                                {tab === 'perf' && <PerfView perf={perfDiff} />}
                            </div>
                        </>
                    );
                })()}
            </div>
        </div>
    );
}

function DiffTabs({
    tab,
    onTab,
    summary,
    infoCount,
}: {
    tab: DiffTab;
    onTab: (t: DiffTab) => void;
    summary: SessionDiff['summary'];
    infoCount: number;
}) {
    const frameChanges = summary.changed + summary.added + summary.removed;
    const tabs: Array<{ id: DiffTab; label: string; badge: number }> = [
        { id: 'frames', label: 'frames', badge: frameChanges },
        { id: 'info', label: 'info', badge: infoCount },
        { id: 'perf', label: 'perf', badge: 0 },
    ];
    return (
        <div className="flex items-center gap-1 border-b border-line bg-surface-elev px-5 py-1.5">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    onClick={() => onTab(t.id)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors',
                        tab === t.id
                            ? 'bg-surface-rowHover text-ink-primary'
                            : 'text-ink-muted hover:text-ink-secondary',
                    )}
                >
                    {t.label}
                    {t.badge > 0 && (
                        <span className="rounded-sm border border-line px-1 text-[9px] text-ink-secondary">
                            {t.badge}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

function FramesView({
    diff,
    bLabel,
    hideEqual,
    onHideEqual,
    visibleRows,
    expanded,
    onToggleExpand,
}: {
    diff: SessionDiff;
    bLabel: string | null;
    hideEqual: boolean;
    onHideEqual: (v: boolean) => void;
    visibleRows: Array<{ row: DiffRow; index: number }>;
    expanded: number | null;
    onToggleExpand: (index: number) => void;
}) {
    const identical =
        diff.summary.changed === 0 && diff.summary.added === 0 && diff.summary.removed === 0;
    return (
        <>
            <div className={cn(TAB_BAR, 'font-mono text-[11px]')}>
                <span className="text-ink-muted">{diff.summary.equal} same</span>
                <span className="text-accent-warn">{diff.summary.changed} differs</span>
                <span className="text-accent-error">{diff.summary.removed} only in A</span>
                <span className="text-accent-ok">{diff.summary.added} only in B</span>
                <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[10px] uppercase tracking-widest text-ink-muted">
                    <input
                        type="checkbox"
                        checked={hideEqual}
                        onChange={(e) => onHideEqual(e.target.checked)}
                        className="accent-accent-info"
                    />
                    hide unchanged
                </label>
            </div>
            {identical ? (
                <Hint tone="ok">
                    Sessions are identical{bLabel ? ` — every frame in B (${bLabel}) matches A` : ''}.
                </Hint>
            ) : visibleRows.length === 0 ? (
                <Hint>Only unchanged frames — toggle “hide unchanged” to see them.</Hint>
            ) : (
                <table className="w-full table-fixed border-collapse font-mono text-[11px]">
                    <colgroup>
                        <col className="w-[24px]" />
                        <col className="w-1/2" />
                        <col className="w-1/2" />
                    </colgroup>
                    <tbody>
                        {visibleRows.map(({ row, index }) => (
                            <DiffRowView
                                key={index}
                                row={row}
                                expanded={expanded === index}
                                onToggle={() => onToggleExpand(index)}
                            />
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
}

// Legend for the field-level glyphs. These mean something different from the
// frame-row markers (=/≠/◂/▸): here they are per-field — a value changed, or a
// key present on only one side — so the key is spelled out wherever they show.
function ChangeLegend() {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
            <span className="inline-flex items-baseline gap-1">
                <span className="text-accent-warn">~</span> changed
            </span>
            <span className="inline-flex items-baseline gap-1">
                <span className="text-accent-ok">+</span> only in B
            </span>
            <span className="inline-flex items-baseline gap-1">
                <span className="text-accent-error">−</span> only in A
            </span>
        </div>
    );
}

function InfoView({ meta }: { meta: MetadataDiff }) {
    if (meta.changes.length === 0) {
        return (
            <Hint tone="ok">
                Metadata identical — same client, agent, capabilities, protocol and runtime.
            </Hint>
        );
    }
    return (
        <>
            <div className={TAB_BAR}>
                <ChangeLegend />
            </div>
            <ul className="space-y-1 px-5 py-3 font-mono text-[11px]">
                {meta.changes.map((c, i) => (
                    <li key={i} className="leading-snug">
                        <ChangeLine change={c} />
                    </li>
                ))}
            </ul>
        </>
    );
}

function fmtLatencyCell(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : formatLatency(v);
}
function fmtDelta(v: number | null): { text: string; tone: string } {
    if (v === null) return { text: '—', tone: 'text-ink-dim' };
    if (v === 0) return { text: '0', tone: 'text-ink-muted' };
    // Slower (positive) is worse → red; faster → green.
    const sign = v > 0 ? '+' : '−';
    return {
        text: sign + formatLatency(Math.abs(v)),
        tone: v > 0 ? 'text-accent-error' : 'text-accent-ok',
    };
}

function PerfView({ perf }: { perf: MethodStatsDelta[] }) {
    if (perf.length === 0) {
        return <Hint>No methods to compare.</Hint>;
    }
    return (
        <>
            <div className={cn(TAB_BAR, 'font-mono text-[10px] uppercase tracking-widest text-ink-muted')}>
                <span>Δ = B − A · sorted by |Δ p99|</span>
                <span className="inline-flex items-baseline gap-1">
                    <span className="text-accent-error">+</span> slower in B
                </span>
                <span className="inline-flex items-baseline gap-1">
                    <span className="text-accent-ok">−</span> faster in B
                </span>
            </div>
            <table className="w-full text-[11px]">
                <thead className="sticky top-0 z-10 bg-surface-base">
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                    <th className="py-2 pl-5 pr-3">method</th>
                    <th className="px-3 py-2">kind</th>
                    <th className="px-3 py-2 text-right">A p99</th>
                    <th className="px-3 py-2 text-right">B p99</th>
                    <th className="px-3 py-2 text-right">Δ p99</th>
                    <th className="px-3 py-2 text-right">count</th>
                </tr>
            </thead>
            <tbody className="font-mono">
                {perf.map((d) => {
                    const delta = fmtDelta(d.p99Delta);
                    return (
                        <tr
                            key={`${d.kind}:${d.method}`}
                            className="border-b border-line/40 hover:bg-surface-rowHover/50"
                        >
                            <td className="truncate py-1.5 pl-5 pr-3 text-ink-primary" title={d.method}>
                                {d.method}
                            </td>
                            <td className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-ink-muted">
                                {d.kind === 'request' ? 'req' : 'ntf'}
                            </td>
                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                {fmtLatencyCell(d.a?.p99 ?? null)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-ink-secondary">
                                {fmtLatencyCell(d.b?.p99 ?? null)}
                            </td>
                            <td className={cn('px-3 py-1.5 text-right', delta.tone)}>{delta.text}</td>
                            <td className="px-3 py-1.5 text-right text-ink-muted">
                                {d.a?.count ?? 0}→{d.b?.count ?? 0}
                            </td>
                        </tr>
                    );
                })}
                </tbody>
            </table>
        </>
    );
}

/** Full-height centered message for the gating states (no A/B yet, loading…). */
function Filler({ children, tone }: { children: React.ReactNode; tone?: 'muted' | 'error' | 'ok' }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <Hint {...(tone ? { tone } : {})}>{children}</Hint>
        </div>
    );
}

const OP_TINT: Record<DiffRow['op'], string> = {
    equal: '',
    changed: 'bg-accent-warn/5',
    added: 'bg-accent-ok/5',
    removed: 'bg-accent-error/5',
};

// Set-membership framing (two independent sessions, not before/after of one
// artifact): same / differs / only-in-A / only-in-B. The arrow points at the
// side that actually holds the frame, matching the filled column.
const OP_MARK: Record<DiffRow['op'], { glyph: string; tone: string }> = {
    equal: { glyph: '=', tone: 'text-ink-dim' },
    changed: { glyph: '≠', tone: 'text-accent-warn' },
    added: { glyph: '▸', tone: 'text-accent-ok' },
    removed: { glyph: '◂', tone: 'text-accent-error' },
};

function DiffRowView({
    row,
    expanded,
    onToggle,
}: {
    row: DiffRow;
    expanded: boolean;
    onToggle: () => void;
}) {
    const mark = OP_MARK[row.op];
    const changeable = row.op === 'changed' && row.changes.length > 0;
    return (
        <>
            <tr
                className={cn(
                    'border-b border-line/40 align-top',
                    OP_TINT[row.op],
                    changeable && 'cursor-pointer hover:bg-accent-warn/10',
                )}
                onClick={changeable ? onToggle : undefined}
            >
                <td className={cn('py-1.5 pl-5 text-center', mark.tone)}>{mark.glyph}</td>
                <td className="px-3 py-1.5">
                    <FrameCell frame={row.a} muted={row.op === 'added'} />
                </td>
                <td className="px-3 py-1.5">
                    <FrameCell frame={row.b} muted={row.op === 'removed'} />
                    {changeable && (
                        <span className="ml-2 text-[10px] text-accent-warn">
                            {expanded ? '▾' : '▸'} {row.changes.length} field
                            {row.changes.length === 1 ? '' : 's'}
                        </span>
                    )}
                </td>
            </tr>
            {changeable && expanded && (
                <tr className="border-b border-line/40 bg-surface-elev">
                    <td />
                    <td colSpan={2} className="px-5 py-2">
                        <div className="mb-1.5">
                            <ChangeLegend />
                        </div>
                        <ul className="space-y-1">
                            {row.changes.map((c, i) => (
                                <li key={i} className="leading-snug">
                                    <ChangeLine change={c} />
                                </li>
                            ))}
                        </ul>
                    </td>
                </tr>
            )}
        </>
    );
}

function FrameCell({ frame, muted }: { frame: CapturedMessage | null; muted: boolean }) {
    if (frame === null) {
        return <span className="text-ink-dim">—</span>;
    }
    const method = frame.method ?? (frame.parseError ? `! ${frame.parseError}` : '—');
    return (
        <span className={cn('inline-flex items-baseline gap-2', muted && 'opacity-60')}>
            <span className="text-ink-dim">{dirArrow(frame)}</span>
            <span className="text-[10px] uppercase tracking-widest text-ink-muted">
                {KIND_LABEL[frame.kind]}
            </span>
            <span className="truncate text-ink-primary" title={method}>
                {method}
            </span>
            <span className="text-ink-dim">#{frame.seq}</span>
        </span>
    );
}

const VALUE_MAX = 80;

function fmtValue(v: unknown): string {
    let s: string;
    try {
        s = JSON.stringify(v);
    } catch {
        s = String(v);
    }
    if (s === undefined) s = 'undefined';
    if (s.length > VALUE_MAX) s = s.slice(0, VALUE_MAX - 1) + '…';
    return s;
}

function ChangeLine({ change }: { change: JsonChange }) {
    if (change.kind === 'add') {
        return (
            <span>
                <span className="text-accent-ok">+ </span>
                <span className="text-ink-secondary">{change.path}</span>
                <span className="text-ink-muted">: </span>
                <span className="text-accent-ok">{fmtValue(change.b)}</span>
            </span>
        );
    }
    if (change.kind === 'remove') {
        return (
            <span>
                <span className="text-accent-error">− </span>
                <span className="text-ink-secondary">{change.path}</span>
                <span className="text-ink-muted">: </span>
                <span className="text-accent-error line-through">{fmtValue(change.a)}</span>
            </span>
        );
    }
    return (
        <span>
            <span className="text-accent-warn">~ </span>
            <span className="text-ink-secondary">{change.path}</span>
            <span className="text-ink-muted">: </span>
            <span className="text-accent-error line-through">{fmtValue(change.a)}</span>
            <span className="text-ink-muted"> → </span>
            <span className="text-accent-ok">{fmtValue(change.b)}</span>
        </span>
    );
}

function Hint({
    children,
    tone = 'muted',
}: {
    children: React.ReactNode;
    tone?: 'muted' | 'error' | 'ok';
}) {
    const toneClass =
        tone === 'error' ? 'text-accent-error' : tone === 'ok' ? 'text-accent-ok' : 'text-ink-muted';
    return (
        <div className={cn('px-5 py-8 text-center font-mono text-[12px]', toneClass)}>{children}</div>
    );
}

/**
 * A/B session selector. Mirrors the TopBar `SessionPicker` look (trigger chip +
 * dropdown with saved/imported sections + per-row dot, id, label, msg-count·age)
 * so picking a side feels the same as picking the active session — minus the
 * live-capture section, the per-row delete, and the other side's current pick.
 */
function SessionDropdown({
    ariaLabel,
    sessions,
    selectedId,
    onSelect,
}: {
    ariaLabel: string;
    sessions: SavedSession[];
    selectedId: number | null;
    onSelect: (id: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    const regular = sessions.filter((s) => s.imported_at === null);
    const imported = sessions.filter((s) => s.imported_at !== null);
    const selected = selectedId !== null ? sessions.find((s) => s.id === selectedId) ?? null : null;
    const label = selected ? savedLabel(selected) : selectedId !== null ? `#${selectedId}` : 'select a session…';

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={cn(
                    'inline-flex h-7 items-center gap-2 rounded-sm border px-3 font-mono text-[10px] uppercase tracking-widest transition-colors',
                    'border-line bg-surface-row text-ink-secondary hover:border-line-strong hover:text-ink-primary',
                    open ? 'border-line-strong text-ink-primary' : '',
                )}
                title={`${ariaLabel} — pick which session to compare`}
            >
                <span className="inline-block w-[240px] truncate text-left">{label}</span>
                <span aria-hidden className={cn('transition-transform', open ? 'rotate-180' : '')}>
                    ▾
                </span>
            </button>
            {open && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[460px] rounded-md border border-line bg-surface-elev shadow-xl">
                    <SectionHeader>
                        saved · {regular.length} session{regular.length === 1 ? '' : 's'}
                    </SectionHeader>
                    {regular.length === 0 && (
                        <div className="px-3 py-3 text-center font-mono text-[11px] text-ink-muted">
                            no other saved sessions to compare
                        </div>
                    )}
                    <ul className="max-h-[300px] overflow-y-auto">
                        {regular.map((s) => (
                            <PickerRow
                                key={s.id}
                                s={s}
                                active={s.id === selectedId}
                                onPick={() => {
                                    onSelect(s.id);
                                    setOpen(false);
                                }}
                            />
                        ))}
                    </ul>
                    {imported.length > 0 && (
                        <>
                            <SectionHeader>
                                imported · {imported.length} file{imported.length === 1 ? '' : 's'}
                            </SectionHeader>
                            <ul className="max-h-[200px] overflow-y-auto">
                                {imported.map((s) => (
                                    <PickerRow
                                        key={s.id}
                                        s={s}
                                        active={s.id === selectedId}
                                        onPick={() => {
                                            onSelect(s.id);
                                            setOpen(false);
                                        }}
                                    />
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <div className="border-b border-line bg-surface-base/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
            {children}
        </div>
    );
}

function PickerRow({ s, active, onPick }: { s: SavedSession; active: boolean; onPick: () => void }) {
    return (
        <li>
            <button
                type="button"
                onClick={onPick}
                title={`session #${s.id} · ${s.agent_command ?? ''} · ${s.message_count} messages`}
                className={cn(
                    'flex w-full items-baseline gap-3 border-b border-line-grid/70 px-3 py-2 text-left transition-colors hover:bg-surface-rowHover',
                    active ? 'bg-surface-rowHover' : '',
                )}
            >
                <span
                    aria-hidden
                    className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        active ? 'bg-accent-note animate-pulse-soft' : 'bg-ink-dim',
                    )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-primary">
                    <span className="text-accent-note">#{s.id}</span>
                    <span className="text-ink-muted"> · </span>
                    {s.name ??
                        (s.client_name
                            ? `${s.client_name} · ${shortAgentName(s.agent_command ?? '')}`
                            : shortAgentName(s.agent_command ?? ''))}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                    {s.message_count}msg · {formatAge(s.started_at)}
                </span>
            </button>
        </li>
    );
}

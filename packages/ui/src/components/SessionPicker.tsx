import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { refreshSavedSessions } from '../api/discovery';
import { captureLabel, shortAgentName } from '../lib/captureLabel';
import { formatAge } from '../lib/format';
import {
    deleteSession as apiDeleteSession,
    isReplayUrl,
    replayUrlFor,
    sessionIdFromReplayUrl,
    type SavedSession,
} from '../api/sessions';
import { useDiscoveryStore } from '../store/discoveryStore';

interface SessionPickerProps {
    onSelect: (url: string) => void;
    activeUrl: string | null;
    overrideUrl: string | null;
}

export function SessionPicker({ onSelect, activeUrl, overrideUrl }: SessionPickerProps) {
    const captures = useDiscoveryStore((s) => s.captures);
    const savedSessions = useDiscoveryStore((s) => s.savedSessions);
    const lastFetchAt = useDiscoveryStore((s) => s.lastFetchAt);
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

    const currentCapture = captures.find((c) => c.url === activeUrl) ?? null;
    const replayId = activeUrl !== null && isReplayUrl(activeUrl)
        ? sessionIdFromReplayUrl(activeUrl)
        : null;
    // Hide saved sessions that are still live — they would appear twice in the
    // list (once as the running proxy, once as their row in captures.db).
    const liveDbIds = useMemo(
        () =>
            new Set(
                captures
                    .map((c) => c.sessionDbId)
                    .filter((id): id is number => id !== null),
            ),
        [captures],
    );
    const savedOnly = useMemo(
        () => savedSessions.filter((s) => !liveDbIds.has(s.id)),
        [savedSessions, liveDbIds],
    );
    const savedRegular = useMemo(
        () => savedOnly.filter((s) => s.imported_at === null),
        [savedOnly],
    );
    const savedImported = useMemo(
        () => savedOnly.filter((s) => s.imported_at !== null),
        [savedOnly],
    );
    const currentSaved =
        replayId !== null ? savedOnly.find((s) => s.id === replayId) ?? null : null;
    const totalCount = captures.length + savedOnly.length;

    let label: string;
    if (overrideUrl) label = '?ws override';
    else if (currentCapture) label = captureLabel(currentCapture);
    else if (currentSaved)
        label = `#${currentSaved.id} · ${
            currentSaved.name ??
            (currentSaved.client_name
                ? `${currentSaved.client_name} · ${shortAgentName(currentSaved.agent_command ?? '')}`
                : shortAgentName(currentSaved.agent_command ?? ''))
        }`;
    else if (totalCount === 0) label = 'no captures';
    else label = 'pick capture';

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'inline-flex h-7 items-center gap-2 rounded-sm border px-3 font-mono text-[10px] uppercase tracking-widest transition-colors',
                    'border-line bg-surface-row text-ink-secondary hover:border-line-strong hover:text-ink-primary',
                    open ? 'border-line-strong text-ink-primary' : '',
                )}
                title="Select a live capture or saved session"
            >
                <span className="inline-block w-[200px] truncate text-left">{label}</span>
                {totalCount > 1 && !overrideUrl && (
                    <span className="rounded-sm border border-line-strong px-1 text-[9px] text-ink-secondary">
                        {totalCount}
                    </span>
                )}
                <span aria-hidden className={cn('transition-transform', open ? 'rotate-180' : '')}>
                    ▾
                </span>
            </button>
            {open && (
                <div
                    className={cn(
                        'absolute right-0 top-[calc(100%+6px)] z-50 w-[460px] rounded-md border border-line bg-surface-elev shadow-xl',
                    )}
                >
                    <SectionHeader>
                        live captures · last poll{' '}
                        {lastFetchAt
                            ? `${Math.round((Date.now() - lastFetchAt) / 1000)}s ago`
                            : '—'}
                    </SectionHeader>
                    {captures.length === 0 && (
                        <div className="px-3 py-3 text-center font-mono text-[11px] text-ink-muted">
                            none. start a proxy with{' '}
                            <span className="text-ink-secondary">acp-devtools proxy …</span>
                        </div>
                    )}
                    <ul className="max-h-[260px] overflow-y-auto">
                        {captures.map((c) => (
                            <li key={c.url}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSelect(c.url);
                                        setOpen(false);
                                    }}
                                    title={`${c.agentCommand} · ${c.url}${c.saveTo ? ' · saved to local store' : ' · not persisted'}`}
                                    className={cn(
                                        'flex w-full items-baseline gap-3 border-b border-line-grid/70 px-3 py-2 text-left transition-colors hover:bg-surface-rowHover',
                                        c.url === activeUrl ? 'bg-surface-rowHover' : '',
                                    )}
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            'h-2 w-2 shrink-0 rounded-full',
                                            c.url === activeUrl
                                                ? 'bg-accent-out animate-pulse-soft'
                                                : 'bg-accent-warn/50',
                                        )}
                                    />
                                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-primary">
                                        <span className="text-accent-out">
                                            {c.sessionDbId !== null
                                                ? `#${c.sessionDbId}`
                                                : `pid ${c.pid}`}
                                        </span>
                                        <span className="text-ink-muted"> · </span>
                                        {c.sessionName ??
                                            (c.clientName
                                                ? `${c.clientName} · ${shortAgentName(c.agentCommand)}`
                                                : shortAgentName(c.agentCommand))}
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                                        {formatAge(c.startedAt)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <SectionHeader>
                        saved · {savedRegular.length} session{savedRegular.length === 1 ? '' : 's'}
                    </SectionHeader>
                    {savedRegular.length === 0 && (
                        <div className="px-3 py-3 text-center font-mono text-[11px] text-ink-muted">
                            {savedSessions.length === 0
                                ? 'no saved sessions yet'
                                : savedImported.length > 0
                                  ? 'no live-captured sessions yet'
                                  : 'all saved sessions are currently live'}
                        </div>
                    )}
                    <ul className="max-h-[300px] overflow-y-auto">
                        {savedRegular.map((s) => (
                            <SavedRow
                                key={s.id}
                                s={s}
                                activeUrl={activeUrl}
                                onPick={(url) => {
                                    onSelect(url);
                                    setOpen(false);
                                }}
                            />
                        ))}
                    </ul>

                    {(savedImported.length > 0 || savedSessions.some((s) => s.imported_at !== null)) && (
                        <>
                            <SectionHeader>
                                imported · {savedImported.length} file
                                {savedImported.length === 1 ? '' : 's'}
                            </SectionHeader>
                            {savedImported.length === 0 ? (
                                <div className="px-3 py-3 text-center font-mono text-[11px] text-ink-muted">
                                    no imported files
                                </div>
                            ) : (
                                <ul className="max-h-[200px] overflow-y-auto">
                                    {savedImported.map((s) => (
                                        <SavedRow
                                            key={s.id}
                                            s={s}
                                            activeUrl={activeUrl}
                                            onPick={(url) => {
                                                onSelect(url);
                                                setOpen(false);
                                            }}
                                        />
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {overrideUrl && (
                        <div className="border-t border-line px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-accent-warn">
                            ?ws override active — discovery selection ignored
                        </div>
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

interface SavedRowProps {
    s: SavedSession;
    activeUrl: string | null;
    onPick: (url: string) => void;
}

function SavedRow({ s, activeUrl, onPick }: SavedRowProps) {
    const url = replayUrlFor(s.id);
    const isActive = url === activeUrl;
    const onDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        const label = s.name ?? shortAgentName(s.agent_command ?? '');
        if (!window.confirm(`Delete session #${s.id} ${label} forever?`)) {
            return;
        }
        void (async () => {
            try {
                await apiDeleteSession(s.id);
                if (isActive) useDiscoveryStore.getState().setSelected(null);
                await refreshSavedSessions();
            } catch (err) {
                // Surfacing through alert is crude but acceptable for an
                // explicit destructive action the user just confirmed —
                // silent failure would leave a phantom row.
                const msg = err instanceof Error ? err.message : String(err);
                window.alert(`Delete failed: ${msg}`);
            }
        })();
    };
    return (
        <li className="group relative">
            <button
                type="button"
                onClick={() => onPick(url)}
                title={`session #${s.id} · ${s.agent_command ?? ''} · ${s.message_count} messages`}
                className={cn(
                    'flex w-full items-baseline gap-3 border-b border-line-grid/70 px-3 py-2 text-left transition-colors hover:bg-surface-rowHover',
                    isActive ? 'bg-surface-rowHover' : '',
                )}
            >
                <span
                    aria-hidden
                    className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        isActive ? 'bg-accent-note animate-pulse-soft' : 'bg-ink-dim',
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
                <span
                    className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors group-hover:text-ink-secondary"
                >
                    {s.message_count}msg · {formatAge(s.started_at)}
                </span>
            </button>
            <button
                type="button"
                onClick={onDelete}
                aria-label={`delete session #${s.id} forever`}
                title="Delete this session permanently"
                className={cn(
                    // Hidden until the row is hovered; once revealed the
                    // button rests on a translucent (70%) bg so it stays
                    // unobtrusive in the list. Direct hover lifts to fully
                    // solid bg-surface-rowHover + accent so it reads as
                    // clickable.
                    'absolute right-2 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm border border-line bg-surface-elev/70 text-[12px] leading-none text-ink-muted transition-colors',
                    'group-hover:flex hover:border-accent-error/70 hover:bg-surface-rowHover hover:text-accent-error',
                )}
            >
                <span aria-hidden>×</span>
            </button>
        </li>
    );
}


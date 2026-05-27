import { cn } from '../lib/cn';
import { reconnect } from '../api/websocket';
import {
    type ConnectionStatus,
    useMessagesStore,
} from '../store/messagesStore';
import { formatAge, formatDateTime } from '../lib/format';
import { sessionHeader } from '../lib/captureLabel';
import { useNow } from '../lib/useNow';
import { SessionActionsMenu, type SessionActionToastTone } from './SessionActionsMenu';
import { SessionPicker } from './SessionPicker';
import { ThemeToggle } from './ThemeToggle';

export type TopBarToastTone = SessionActionToastTone;

interface TopBarProps {
    wsUrl: string;
    overrideUrl: string | null;
    activeUrl: string | null;
    isReplay: boolean;
    isImported?: boolean;
    onPickCapture: ((url: string) => void) | null;
    /**
     * Surface import outcomes — successful loads and parse errors — to the
     * App-level Toast. Optional so tests and standalone usage of TopBar do
     * not have to wire it.
     */
    onImportResult?: (message: string, tone: TopBarToastTone) => void;
    /**
     * Opens the side drawer with derived session metadata (client/agent
     * capabilities, runtime state). Wired at App level.
     */
    onOpenInfo?: () => void;
    /**
     * Opens the full-screen perf dashboard (table + insights + waterfall
     * timeline). Wired at App level.
     */
    onOpenPerf?: () => void;
}

export function TopBar({
    wsUrl,
    overrideUrl,
    activeUrl,
    isReplay,
    isImported = false,
    onPickCapture,
    onImportResult,
    onOpenInfo,
    onOpenPerf,
}: TopBarProps) {
    const connection = useMessagesStore((s) => s.connection);
    const session = useMessagesStore((s) => s.session);
    const lastError = useMessagesStore((s) => s.lastError);
    const lastEventTs = useMessagesStore((s) =>
        s.messages.length > 0 ? s.messages[s.messages.length - 1]!.timestamp : null,
    );
    const now = useNow(5000);

    return (
        <header className="flex items-center justify-between border-b border-line bg-surface-base px-5 py-2.5">
            <div className="flex items-center gap-4">
                <div className="wordmark-rule">
                    <span className="font-display text-[18px] uppercase tracking-[0.18em] text-ink-primary">
                        acp.devtools
                    </span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                    v0.1.0
                </span>
            </div>

            <div className="flex items-center gap-4">
                {session &&
                    (() => {
                        const { primary } = sessionHeader(session);
                        // `isReplay` / `isImported` (passed in from App) are the
                        // authoritative signals — they come from the URL form
                        // (/replay/N) or imported file state respectively, and
                        // do not require `endedAt` to be set (proxies that
                        // crashed leave endedAt = NULL forever).
                        const frozen = isReplay || isImported;
                        const frozenEndTs =
                            session.endedAt !== null
                                ? session.endedAt
                                : lastEventTs ?? session.startedAt;
                        const durationLabel = frozen
                            ? formatAge(session.startedAt, frozenEndTs)
                            : formatAge(session.startedAt, now);
                        const idleMs = lastEventTs !== null ? now - lastEventTs : null;
                        const showIdle = !frozen && idleMs !== null && idleMs > 5000;
                        const startedFriendly = formatDateTime(session.startedAt, now);
                        const modeLabel = isImported
                            ? 'IMPORTED'
                            : isReplay
                              ? 'REPLAY'
                              : 'SESSION';
                        const modeTitle = isImported
                            ? 'session loaded from a JSON file on disk — not connected to any proxy'
                            : isReplay
                              ? 'replay of a saved session — proxy has ended'
                              : 'live capture — proxy process is still running';
                        const idColor = isImported
                            ? 'text-accent-warn'
                            : isReplay
                              ? 'text-accent-note'
                              : 'text-accent-out';
                        return (
                            <div className="flex items-center gap-3 font-mono text-[11px] text-ink-secondary">
                                <span className="text-ink-muted" title={modeTitle}>
                                    {modeLabel}
                                </span>
                                <span
                                    className={idColor}
                                    title={
                                        session.agentCommand
                                            ? `session #${session.id} · ${session.agentCommand}`
                                            : 'persisted session id'
                                    }
                                >
                                    {primary}
                                </span>
                                <span className="text-ink-muted">·</span>
                                <span title={`session started at ${startedFriendly}`}>
                                    {formatDateTime(session.startedAt, now)}
                                </span>
                                {durationLabel && (
                                    <>
                                        <span className="text-ink-muted">·</span>
                                        <span
                                            className="text-ink-muted"
                                            title={
                                                frozen
                                                    ? 'capture duration (start → end of recorded session)'
                                                    : 'how long the proxy process has been alive'
                                            }
                                        >
                                            {frozen ? 'lasted' : 'alive'} {durationLabel}
                                        </span>
                                    </>
                                )}
                                {showIdle && (
                                    <>
                                        <span className="text-ink-muted">·</span>
                                        <span
                                            className="text-ink-dim"
                                            title={`time since the most recent ACP frame · last event ${formatDateTime(
                                                lastEventTs!,
                                                now,
                                            )}`}
                                        >
                                            idle {formatAge(lastEventTs!, now)}
                                        </span>
                                    </>
                                )}
                            </div>
                        );
                    })()}
                <div className="flex items-center gap-1.5">
                    {onPickCapture && (
                        <SessionPicker
                            onSelect={onPickCapture}
                            activeUrl={activeUrl}
                            overrideUrl={overrideUrl}
                        />
                    )}
                    <ConnectionPill
                        status={connection}
                        wsUrl={wsUrl}
                        lastError={lastError}
                        isReplay={isReplay}
                        isImported={isImported}
                        onReconnect={reconnect}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    {onOpenInfo && session && (
                        <button
                            type="button"
                            onClick={onOpenInfo}
                            className="inline-flex h-7 items-center rounded-sm border border-line bg-surface-row px-3 font-mono text-[10px] uppercase tracking-widest text-ink-secondary transition-colors hover:bg-surface-rowHover hover:text-ink-primary"
                            title="Show session info — client/agent capabilities, runtime state"
                            aria-label="Open session info panel"
                        >
                            info
                        </button>
                    )}
                    {onOpenPerf && session && (
                        <button
                            type="button"
                            onClick={onOpenPerf}
                            className="inline-flex h-7 items-center rounded-sm border border-line bg-surface-row px-3 font-mono text-[10px] uppercase tracking-widest text-ink-secondary transition-colors hover:bg-surface-rowHover hover:text-ink-primary"
                            title="Show performance dashboard — per-method latency stats and waterfall timeline"
                            aria-label="Open performance dashboard"
                        >
                            perf
                        </button>
                    )}
                    <SessionActionsMenu
                        {...(onImportResult ? { onImportResult } : {})}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <ThemeToggle />
                </div>
            </div>
        </header>
    );
}

function ConnectionPill({
    status,
    wsUrl,
    lastError,
    isReplay,
    isImported,
    onReconnect,
}: {
    status: ConnectionStatus;
    wsUrl: string;
    lastError: string | null;
    isReplay: boolean;
    isImported: boolean;
    onReconnect: () => void;
}) {
    if (isImported) {
        // Imported views are inherently disconnected — nothing to reconnect to.
        // The pill becomes a passive «FILE» badge instead of a status surface.
        return (
            <div
                className="inline-flex h-7 cursor-default items-center gap-2 rounded-sm border border-accent-warn/40 bg-accent-warn/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent-warn"
                title={`viewing data from a JSON file · ${wsUrl}`}
            >
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent-warn" />
                <span className="inline-block min-w-[52px] text-center">FILE</span>
            </div>
        );
    }
    const openText = isReplay ? 'REPLAY' : 'LIVE';
    const text =
        status === 'open'
            ? openText
            : status === 'connecting'
              ? 'WAITING'
              : status === 'idle'
                ? 'IDLE'
                : status === 'closed'
                  ? 'CLOSED'
                  : 'ERROR';
    const openTone = isReplay
        ? 'text-accent-note bg-accent-note/10 border-accent-note/40'
        : 'text-accent-out bg-accent-out/10 border-accent-out/40';
    const tone: Record<ConnectionStatus, string> = {
        idle: 'text-ink-secondary bg-surface-row border-line',
        connecting: 'text-accent-warn/80 bg-accent-warn/10 border-accent-warn/30',
        open: openTone,
        closed: 'text-ink-secondary bg-surface-row border-line',
        error: 'text-accent-error bg-accent-error/10 border-accent-error/40',
    };
    const openDot = isReplay ? 'bg-accent-note animate-pulse-soft' : 'bg-accent-out animate-pulse-soft';
    const dotClass =
        status === 'open'
            ? openDot
            : status === 'connecting'
              ? 'bg-accent-warn/60 animate-pulse-soft'
              : status === 'error'
                ? 'bg-accent-error'
                : 'bg-ink-dim';
    const allowRetry = status === 'idle' || status === 'closed' || status === 'error';
    const titleBase = isReplay
        ? 'serving a recorded session from the local store'
        : 'connected to a live proxy capture';
    const tooltip = lastError
        ? lastError
        : status === 'open'
          ? `${titleBase} · ${wsUrl}`
          : allowRetry
            ? `click to reconnect · ${wsUrl}`
            : wsUrl;
    return (
        <button
            type="button"
            onClick={allowRetry ? onReconnect : undefined}
            disabled={!allowRetry}
            className={cn(
                'inline-flex h-7 items-center gap-2 rounded-sm border px-3 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors',
                tone[status],
                allowRetry ? 'cursor-pointer hover:bg-surface-rowHover' : 'cursor-default',
            )}
            title={tooltip}
        >
            <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', dotClass)} />
            <span className="inline-block min-w-[52px] text-center">{text}</span>
        </button>
    );
}

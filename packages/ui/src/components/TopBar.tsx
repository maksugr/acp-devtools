import { cn } from '../lib/cn';
import { reconnect } from '../api/websocket';
import {
    type ConnectionStatus,
    useMessagesStore,
} from '../store/messagesStore';
import { formatAge, formatDateTime } from '../lib/format';
import { sessionHeader } from '../lib/captureLabel';
import { useNow } from '../lib/useNow';
import { SessionPicker } from './SessionPicker';
import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
    wsUrl: string;
    overrideUrl: string | null;
    activeUrl: string | null;
    isReplay: boolean;
    onPickCapture: ((url: string) => void) | null;
}

export function TopBar({
    wsUrl,
    overrideUrl,
    activeUrl,
    isReplay,
    onPickCapture,
}: TopBarProps) {
    const connection = useMessagesStore((s) => s.connection);
    const session = useMessagesStore((s) => s.session);
    const lastError = useMessagesStore((s) => s.lastError);
    const clear = useMessagesStore((s) => s.clear);
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
                        // `isReplay` (passed in from App) is the authoritative
                        // signal — it comes from the URL form (/replay/N) and
                        // does not require `endedAt` to be set (proxies that
                        // crashed leave endedAt = NULL forever).
                        const replayEndTs =
                            session.endedAt !== null
                                ? session.endedAt
                                : lastEventTs ?? session.startedAt;
                        const durationLabel = isReplay
                            ? formatAge(session.startedAt, replayEndTs)
                            : formatAge(session.startedAt, now);
                        const idleMs = lastEventTs !== null ? now - lastEventTs : null;
                        const showIdle = !isReplay && idleMs !== null && idleMs > 5000;
                        const startedIso = new Date(session.startedAt).toISOString();
                        return (
                            <div className="flex items-center gap-3 font-mono text-[11px] text-ink-secondary">
                                <span
                                    className="text-ink-muted"
                                    title={
                                        isReplay
                                            ? 'replay of a saved session — proxy has ended'
                                            : 'live capture — proxy process is still running'
                                    }
                                >
                                    {isReplay ? 'REPLAY' : 'SESSION'}
                                </span>
                                <span
                                    className={cn(
                                        isReplay ? 'text-accent-note' : 'text-accent-out',
                                    )}
                                    title={
                                        session.agentCommand
                                            ? `session #${session.id} · ${session.agentCommand}`
                                            : 'session id assigned in ~/.acp-devtools/captures.db'
                                    }
                                >
                                    {primary}
                                </span>
                                <span className="text-ink-muted">·</span>
                                <span title={`session started at ${startedIso}`}>
                                    {formatDateTime(session.startedAt, now)}
                                </span>
                                {durationLabel && (
                                    <>
                                        <span className="text-ink-muted">·</span>
                                        <span
                                            className="text-ink-muted"
                                            title={
                                                isReplay
                                                    ? 'capture duration (start → end of recorded session)'
                                                    : 'how long the proxy process has been alive'
                                            }
                                        >
                                            {isReplay ? 'lasted' : 'alive'} {durationLabel}
                                        </span>
                                    </>
                                )}
                                {showIdle && (
                                    <>
                                        <span className="text-ink-muted">·</span>
                                        <span
                                            className="text-ink-dim"
                                            title={`time since the most recent ACP frame · last event ${new Date(
                                                lastEventTs!,
                                            ).toISOString()}`}
                                        >
                                            idle {formatAge(lastEventTs!, now)}
                                        </span>
                                    </>
                                )}
                            </div>
                        );
                    })()}
                {onPickCapture && (
                    <SessionPicker
                        onSelect={onPickCapture}
                        activeUrl={activeUrl}
                        overrideUrl={overrideUrl}
                    />
                )}
                <button
                    type="button"
                    onClick={clear}
                    className="inline-flex h-7 items-center rounded-sm border border-line px-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:border-line-strong hover:text-ink-secondary"
                    title="Hide current messages from view. They come back when you reopen the session — nothing is deleted from disk."
                >
                    clear
                </button>
                <ConnectionPill
                    status={connection}
                    wsUrl={wsUrl}
                    lastError={lastError}
                    isReplay={isReplay}
                    onReconnect={reconnect}
                />
                <ThemeToggle />
            </div>
        </header>
    );
}

function ConnectionPill({
    status,
    wsUrl,
    lastError,
    isReplay,
    onReconnect,
}: {
    status: ConnectionStatus;
    wsUrl: string;
    lastError: string | null;
    isReplay: boolean;
    onReconnect: () => void;
}) {
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
        ? 'serving a recorded session from captures.db'
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

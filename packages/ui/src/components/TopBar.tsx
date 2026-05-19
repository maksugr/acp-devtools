import { cn } from '../lib/cn';
import { reconnect } from '../api/websocket';
import {
    type ConnectionStatus,
    useMessagesStore,
} from '../store/messagesStore';
import { formatTime } from '../lib/format';
import { sessionHeader } from '../lib/captureLabel';
import { SessionPicker } from './SessionPicker';

interface TopBarProps {
    wsUrl: string;
    overrideUrl: string | null;
    activeUrl: string | null;
    onPickCapture: ((url: string) => void) | null;
}

export function TopBar({ wsUrl, overrideUrl, activeUrl, onPickCapture }: TopBarProps) {
    const connection = useMessagesStore((s) => s.connection);
    const session = useMessagesStore((s) => s.session);
    const lastError = useMessagesStore((s) => s.lastError);
    const clear = useMessagesStore((s) => s.clear);

    return (
        <header className="flex items-center justify-between border-b border-line bg-surface-base px-5 py-2.5">
            <div className="flex items-center gap-4">
                <div className="wordmark-rule">
                    <span className="font-display text-[18px] uppercase tracking-[0.18em] text-ink-primary">
                        acp.devtools
                    </span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                    v0.1.0 · pre-alpha
                </span>
            </div>

            <div className="flex items-center gap-4">
                {session &&
                    (() => {
                        const { primary, secondary } = sessionHeader(session);
                        return (
                            <div className="flex items-center gap-3 font-mono text-[11px] text-ink-secondary">
                                <span className="text-ink-muted">SESSION</span>
                                <span className="text-accent-out">{primary}</span>
                                <span className="text-ink-muted">·</span>
                                <span className="text-ink-primary">{secondary}</span>
                                <span className="text-ink-muted">·</span>
                                <span>{formatTime(session.startedAt)}</span>
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
                    className="rounded-sm border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-muted transition-colors hover:border-line-strong hover:text-ink-secondary"
                    title="Clear messages (does not disconnect)"
                >
                    clear
                </button>
                <ConnectionPill
                    status={connection}
                    wsUrl={wsUrl}
                    lastError={lastError}
                    onReconnect={reconnect}
                />
            </div>
        </header>
    );
}

function ConnectionPill({
    status,
    wsUrl,
    lastError,
    onReconnect,
}: {
    status: ConnectionStatus;
    wsUrl: string;
    lastError: string | null;
    onReconnect: () => void;
}) {
    const text =
        status === 'open'
            ? 'LIVE'
            : status === 'connecting'
              ? 'WAITING'
              : status === 'idle'
                ? 'IDLE'
                : status === 'closed'
                  ? 'CLOSED'
                  : 'ERROR';
    const tone: Record<ConnectionStatus, string> = {
        idle: 'text-ink-secondary bg-surface-row border-line',
        connecting: 'text-accent-warn/80 bg-accent-warn/10 border-accent-warn/30',
        open: 'text-accent-out bg-accent-out/10 border-accent-out/40',
        closed: 'text-ink-secondary bg-surface-row border-line',
        error: 'text-accent-error bg-accent-error/10 border-accent-error/40',
    };
    const dotClass =
        status === 'open'
            ? 'bg-accent-out animate-pulse-soft'
            : status === 'connecting'
              ? 'bg-accent-warn/60 animate-pulse-soft'
              : status === 'error'
                ? 'bg-accent-error'
                : 'bg-ink-dim';
    const allowRetry = status === 'idle' || status === 'closed' || status === 'error';
    return (
        <button
            type="button"
            onClick={allowRetry ? onReconnect : undefined}
            disabled={!allowRetry}
            className={cn(
                'inline-flex items-center gap-2 rounded-sm border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors',
                tone[status],
                allowRetry ? 'cursor-pointer hover:bg-surface-rowHover' : 'cursor-default',
            )}
            title={lastError ?? (allowRetry ? `click to reconnect · ${wsUrl}` : wsUrl)}
        >
            <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', dotClass)} />
            <span>{text}</span>
        </button>
    );
}

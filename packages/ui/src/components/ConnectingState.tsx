import { cn } from '../lib/cn';
import type { ConnectionStatus } from '../store/messagesStore';

interface ConnectingStateProps {
    status: ConnectionStatus;
    url: string;
    lastError: string | null;
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
    idle: 'idle',
    connecting: 'connecting',
    open: 'restoring view',
    closed: 'disconnected',
    error: 'connection error',
};

export function ConnectingState({ status, url, lastError }: ConnectingStateProps) {
    const label = STATUS_TEXT[status];
    const showSpinner = status === 'connecting' || status === 'open';
    return (
        <div className="flex h-full w-full items-center justify-center bg-surface-base">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                <span
                    aria-hidden
                    className={cn(
                        'inline-block h-2 w-2 rounded-full',
                        showSpinner ? 'animate-pulse-soft bg-accent-out' : 'bg-ink-dim',
                        status === 'error' && 'bg-accent-error',
                    )}
                />
                <span>{label}</span>
                <span className="text-ink-dim">·</span>
                <span className="lowercase tracking-normal text-ink-secondary">{url}</span>
                {lastError && status === 'error' && (
                    <>
                        <span className="text-ink-dim">·</span>
                        <span className="lowercase tracking-normal text-accent-error">
                            {lastError}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}

import { cn } from '../lib/cn';
import type { ConnectionStatus } from '../store/messagesStore';

interface EmptyStateProps {
    status: ConnectionStatus;
    lastError: string | null;
    url: string;
    captureCount: number;
}

export function EmptyState({ status, lastError, url, captureCount }: EmptyStateProps) {
    const headline =
        status === 'open'
            ? 'Awaiting messages'
            : status === 'connecting'
              ? 'Connecting'
              : status === 'closed'
                ? 'Disconnected'
                : status === 'error'
                  ? 'Connection error'
                  : 'No live capture';
    const headlineTone =
        status === 'open'
            ? 'text-accent-out'
            : status === 'error'
              ? 'text-accent-error'
              : 'text-ink-secondary';

    return (
        <div className="flex h-full w-full items-center justify-center bg-grid">
            <div className="relative w-[min(640px,90%)] rounded-md border border-line bg-surface-elev/80 p-7 backdrop-blur-sm">
                <div className="mb-1 flex items-baseline gap-3">
                    <span className="font-display text-sm uppercase tracking-[0.18em] text-ink-muted">
                        acp.devtools
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                        v0.1.0 / pre-alpha
                    </span>
                </div>
                <h2 className={cn('font-display text-2xl uppercase tracking-tight', headlineTone)}>
                    {headline}
                </h2>
                <p className="mt-3 font-sans text-sm leading-relaxed text-ink-secondary">
                    Start a proxied agent in a terminal and the inspector will subscribe to its
                    captured traffic over WebSocket. Multiple captures coexist — they appear in
                    the picker at the top right, and the most recent one auto-attaches.
                </p>
                {captureCount > 0 && (
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent-out">
                        {captureCount} live capture{captureCount === 1 ? '' : 's'} discovered — pick one above
                    </p>
                )}

                <div className="mt-5 grid gap-3 font-mono text-[11px]">
                    <div className="rounded border border-line bg-surface-base px-3 py-2">
                        <div className="text-ink-muted">$ wrap your agent through the proxy</div>
                        <div className="mt-1 text-ink-primary">
                            <span className="text-accent-out">acp-devtools</span> proxy{' '}
                            <span className="text-ink-secondary">
                                --save-to session.db --ws-port 3737
                            </span>{' '}
                            <span className="text-accent-in">npx -y @zed-industries/claude-code-acp</span>
                        </div>
                    </div>
                    <div className="rounded border border-line bg-surface-base px-3 py-2">
                        <div className="text-ink-muted">$ or replay a recorded session</div>
                        <div className="mt-1 text-ink-primary">
                            <span className="text-accent-out">acp-devtools</span> replay{' '}
                            <span className="text-ink-secondary">session.db --ws-port 3737</span>
                        </div>
                    </div>
                </div>

                <div className="mt-5 flex items-center gap-3 text-[11px] font-mono">
                    <Indicator status={status} />
                    <span className="text-ink-secondary">{url}</span>
                    {lastError && <span className="text-accent-error">{lastError}</span>}
                </div>
            </div>
        </div>
    );
}

function Indicator({ status }: { status: ConnectionStatus }) {
    const color =
        status === 'open'
            ? 'bg-accent-out'
            : status === 'connecting'
              ? 'bg-accent-warn animate-pulse-soft'
              : status === 'error'
                ? 'bg-accent-error'
                : 'bg-ink-dim';
    return <span className={cn('h-2 w-2 rounded-full', color)} aria-hidden />;
}

import { cn } from '../lib/cn';
import type { ConnectionStatus } from '../store/messagesStore';
import { IdeSnippets } from './IdeSnippets';

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
            <div className="relative w-[min(720px,92%)] rounded-md border border-line bg-surface-elev/80 p-6 backdrop-blur-sm">
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
                <p className="mt-2 font-sans text-sm leading-relaxed text-ink-secondary">
                    Connect an IDE to start streaming ACP frames. Pick yours below — the snippet
                    plugs acp-devtools between editor and agent so every message is captured live.
                </p>
                {captureCount > 0 && (
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent-out">
                        {captureCount} live capture{captureCount === 1 ? '' : 's'} discovered — pick
                        one in the picker above
                    </p>
                )}

                <div className="mt-4">
                    <IdeSnippets />
                </div>

                <div className="mt-4 flex items-center gap-3 font-mono text-[11px]">
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

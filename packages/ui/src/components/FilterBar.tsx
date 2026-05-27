import type { CapturedMessage } from '@acp-devtools/core';
import { cn } from '../lib/cn';
import {
    ALL_DIRECTIONS,
    ALL_KINDS,
    useMessagesStore,
} from '../store/messagesStore';

export function FilterBar() {
    const filters = useMessagesStore((s) => s.filters);
    const toggleDirection = useMessagesStore((s) => s.toggleDirection);
    const toggleKind = useMessagesStore((s) => s.toggleKind);
    const toggleStreams = useMessagesStore((s) => s.toggleStreams);
    const setSearch = useMessagesStore((s) => s.setSearch);

    return (
        <div className="flex items-center gap-3 border-b border-line bg-surface-elev/70 px-4 py-2">
            <div className="flex items-center gap-1">
                {ALL_DIRECTIONS.map((d) => (
                    <DirectionChip
                        key={d}
                        dir={d}
                        active={filters.directions.has(d)}
                        onClick={() => toggleDirection(d)}
                    />
                ))}
            </div>
            <Sep />
            <div className="flex items-center gap-1">
                {ALL_KINDS.map((k) => (
                    <KindChip
                        key={k}
                        kind={k}
                        active={filters.kinds.has(k)}
                        onClick={() => toggleKind(k)}
                    />
                ))}
                <StreamChip active={filters.showStreams} onClick={toggleStreams} />
            </div>
            <div className="ml-auto">
                <input
                    type="search"
                    placeholder="search payload…"
                    value={filters.search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={cn(
                        'h-7 w-64 rounded border border-line bg-surface-base px-2 font-mono text-[11px] text-ink-primary placeholder-ink-muted',
                        'focus:border-accent-out focus:outline-none',
                    )}
                />
            </div>
        </div>
    );
}

const DIRECTION_HELP: Record<CapturedMessage['direction'], string> = {
    'editor-to-agent': 'editor → agent (toggle to filter messages flowing from your IDE to the AI)',
    'agent-to-editor': 'agent → editor (toggle to filter messages coming back from the AI)',
};

const KIND_HELP: Record<CapturedMessage['kind'], string> = {
    request: 'request — expects a response',
    response: 'response — answer to a previous request',
    notification: 'notification — one-way event, no response',
    error: 'error — response carrying an error object',
    unknown: 'unknown — frames that could not be classified as JSON-RPC',
};

function DirectionChip({
    dir,
    active,
    onClick,
}: {
    dir: CapturedMessage['direction'];
    active: boolean;
    onClick: () => void;
}) {
    const isOut = dir === 'editor-to-agent';
    const label = isOut ? '→ OUT' : '← IN';
    const colorClass = isOut ? 'text-accent-out' : 'text-accent-in';
    return (
        <button
            type="button"
            onClick={onClick}
            title={DIRECTION_HELP[dir]}
            className={cn(
                'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest transition-colors',
                active
                    ? cn(colorClass, isOut ? 'border-accent-out/50 bg-accent-out/10' : 'border-accent-in/50 bg-accent-in/10')
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink-secondary',
            )}
        >
            {label}
        </button>
    );
}

function KindChip({
    kind,
    active,
    onClick,
}: {
    kind: CapturedMessage['kind'];
    active: boolean;
    onClick: () => void;
}) {
    const tone: Record<CapturedMessage['kind'], { color: string; border: string; bg: string }> = {
        request: { color: 'text-accent-out', border: 'border-accent-out/50', bg: 'bg-accent-out/10' },
        response: { color: 'text-accent-in', border: 'border-accent-in/50', bg: 'bg-accent-in/10' },
        notification: { color: 'text-accent-note', border: 'border-accent-note/50', bg: 'bg-accent-note/10' },
        error: { color: 'text-accent-error', border: 'border-accent-error/50', bg: 'bg-accent-error/10' },
        unknown: { color: 'text-ink-muted', border: 'border-line', bg: 'bg-surface-row' },
    };
    const t = tone[kind];
    return (
        <button
            type="button"
            onClick={onClick}
            title={KIND_HELP[kind]}
            className={cn(
                'rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors',
                active
                    ? cn(t.color, t.border, t.bg)
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink-secondary',
            )}
        >
            {kind}
        </button>
    );
}

function StreamChip({ active, onClick }: { active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title="stream — collapse runs of agent_message_chunk notifications into a single row"
            className={cn(
                'rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors',
                active
                    ? 'border-accent-note/50 bg-accent-note/10 text-accent-note'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink-secondary',
            )}
        >
            stream
        </button>
    );
}

function Sep() {
    return <span aria-hidden className="h-5 w-px bg-line" />;
}

import { useState } from 'react';
import type { CapturedMessage } from '@acp-devtools/core';
import { cn } from '../lib/cn';
import { formatLatency, formatTimeMs } from '../lib/format';

interface StreamClusterProps {
    messages: CapturedMessage[];
    combinedText: string;
    firstTimestamp: number;
    lastTimestamp: number;
    selectedSeq: number | null;
    onSelect: (seq: number) => void;
}

export function StreamCluster({
    messages,
    combinedText,
    firstTimestamp,
    lastTimestamp,
    selectedSeq,
    onSelect,
}: StreamClusterProps) {
    const [open, setOpen] = useState(false);
    const first = messages[0]!;
    const last = messages[messages.length - 1]!;
    const duration = lastTimestamp - firstTimestamp;
    const trimmed = combinedText.length > 140 ? `${combinedText.slice(0, 140)}…` : combinedText;
    const isSelected =
        selectedSeq !== null && messages.some((m) => m.seq === selectedSeq);

    return (
        <div className="border-b border-line-grid/70">
            <button
                type="button"
                onClick={() => {
                    setOpen((v) => !v);
                    onSelect(first.seq);
                }}
                className={cn(
                    'relative flex w-full items-center gap-3 px-4 py-1.5 text-left font-mono text-[12px] leading-5',
                    'transition-colors hover:bg-surface-rowHover',
                    isSelected ? 'bg-surface-rowHover ring-1 ring-inset ring-accent-note/40' : '',
                )}
            >
                <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-accent-note"
                />
                <span className="w-10 shrink-0 text-right text-ink-muted">
                    {String(first.seq).padStart(3, '0')}…{String(last.seq).padStart(3, '0')}
                </span>
                <span className="w-24 shrink-0 text-ink-secondary">{formatTimeMs(firstTimestamp)}</span>
                <span
                    className="flex w-16 shrink-0 items-center gap-1 font-semibold text-accent-in"
                    title="agent → editor (AI replying or calling the host)"
                >
                    <span aria-hidden>←</span>
                    <span className="text-[10px] tracking-widest">IN</span>
                </span>
                <span
                    className={cn(
                        'inline-flex w-12 shrink-0 items-center justify-center rounded-sm border border-accent-note/40 px-1 text-[10px] font-semibold tracking-widest text-accent-note',
                    )}
                    title={`stream — ${messages.length} consecutive agent_message_chunk notifications collapsed into one row`}
                >
                    STR
                </span>
                <span className="flex flex-1 items-center gap-2 truncate text-ink-primary">
                    <span
                        className="inline-flex h-[14px] w-1 rounded-sm bg-accent-note/60"
                        aria-hidden
                    />
                    <span className="truncate text-ink-secondary">
                        {trimmed || <span className="text-ink-muted">(empty stream)</span>}
                    </span>
                </span>
                <span className="w-20 shrink-0 text-right text-ink-muted">
                    {messages.length} chunks
                </span>
                <span className="w-20 shrink-0 text-right text-ink-muted">
                    {formatLatency(duration)}
                </span>
                <span
                    aria-hidden
                    className={cn(
                        'w-3 shrink-0 text-ink-muted transition-transform',
                        open ? 'rotate-90' : '',
                    )}
                >
                    ▸
                </span>
            </button>
            {open && (
                <div className="border-l border-line-grid/70 bg-surface-base/40">
                    {messages.map((m, i) => (
                        <button
                            key={m.seq}
                            type="button"
                            onClick={() => onSelect(m.seq)}
                            className={cn(
                                'flex w-full items-center gap-3 px-8 py-1 text-left font-mono text-[11px] leading-5 text-ink-secondary',
                                'transition-colors hover:bg-surface-rowHover',
                                selectedSeq === m.seq ? 'bg-surface-rowHover text-ink-primary' : '',
                            )}
                        >
                            <span className="w-10 shrink-0 text-right text-ink-muted">
                                {String(m.seq).padStart(3, '0')}
                            </span>
                            <span className="w-24 shrink-0 text-ink-muted">
                                {formatTimeMs(m.timestamp)}
                            </span>
                            <span className="w-8 shrink-0 text-ink-muted">#{i + 1}</span>
                            <span className="flex-1 truncate text-ink-primary">
                                {chunkPreview(m)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function chunkPreview(m: CapturedMessage): string {
    const payload = m.payload as unknown;
    if (!payload || typeof payload !== 'object') return '';
    const params = (payload as { params?: { update?: { content?: { text?: string } } } }).params;
    return params?.update?.content?.text ?? '';
}
